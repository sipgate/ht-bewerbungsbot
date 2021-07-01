import { isSingleLineField } from "./tools.ts";
import HttpClient from "../http/http.ts";
import {
  sendHomeworkTemplate,
  SendHomeworkTemplateValues,
} from "../messages.ts";
import {
  Candidate,
  CandidateDetails,
  CandidateField,
  CandidateReference,
  CandidateSingleLineField,
  MinimalCandidate,
  Offer,
  StageDetail,
  Task,
  TaskDetails,
} from "./types.ts";

const ADDRESS_FIELD_NAME = "Anrede Override";
const ADMIN_REFERENCE_TYPE = "Admin";
const DEFAULT_SIGNATURE = "Deine Hacking Talents";
const OFFER_BOT_TAG = "HT-Bot Target";
const GITLAB_REPO_FIELD_NAME = "GitLab Repo";

export default class Recruitee extends HttpClient {
  constructor(companyId: string, apiToken: string) {
    super(`https://api.recruitee.com/c/${companyId}`, apiToken);
  }

  private async getOffersWithTag(tag: string): Promise<Offer[]> {
    const allOffers = await this.makeRequest<{ offers: Offer[] }>(`/offers`);

    return allOffers.offers.filter((offer: Offer) => {
      return offer.offer_tags.includes(tag);
    });
  }

  async getAllCandidatesForOffers(
    offers: Offer[],
  ): Promise<MinimalCandidate[]> {
    const response = await this.makeRequest<{ candidates: MinimalCandidate[] }>(
      `/candidates?qualified=true&offers=[${offers.map((offer) => offer.id)}]`,
    );

    return response.candidates;
  }

  async getCandidateTasks(candidateId: number): Promise<Task[]> {
    const response = await this.makeRequest<{ tasks: Task[] }>(
      `/candidates/${candidateId}/tasks`,
    );

    return response.tasks;
  }

  async getTaskDetails(task: Task): Promise<TaskDetails> {
    const response = await this.makeRequest<TaskDetails>(`/tasks/${task.id}`);
    return response;
  }

  async getCandidateWithDetails(candidateId: number): Promise<Candidate> {
    const candidateDetails = await this.makeRequest<CandidateDetails>(
      `/candidates/${candidateId}`,
    );
    return candidateDetails.candidate;
  }

  async completeTask(id: number): Promise<void> {
    await this.makeRequest(`/tasks/${id}`, {
      method: "PUT",
      body: {
        task: {
          completed: true,
        },
      },
    });

    console.log(`[Recruitee] Checked candidate task with taskId ${id}`);
  }

  async addNoteToCandidate(
    candidateId: number,
    message: string,
  ): Promise<void> {
    await this.makeRequest(`/candidates/${candidateId}/notes`, {
      method: "POST",
      body: {
        note: {
          id: null,
          body: message,
        },
      },
    });
  }

  getCandidateAddress(candidate: Candidate): string {
    const addressOverride = candidate.fields.find(
      (field) => field.name == ADDRESS_FIELD_NAME,
    );

    if (addressOverride && isSingleLineField(addressOverride)) {
      const override = addressOverride?.values[0]?.text;
      if (override) {
        return override;
      }
    }

    const nameParts = candidate.name.split(" ");
    return nameParts[0];
  }

  async sendMailToCandidate(
    // deno-lint-ignore camelcase
    candidate_id: number,
    // deno-lint-ignore camelcase
    candidate_email: string,
    subject: string, // TODO: extract subject into Mail-templates
    sendHomeworkTemplateValues: SendHomeworkTemplateValues,
  ): Promise<unknown> {
    const homeworkMailContent = sendHomeworkTemplate(
      sendHomeworkTemplateValues,
    );

    const body = {
      // deno-lint-ignore camelcase
      body_html: homeworkMailContent,
      subject,
      to: [
        {
          candidate_id,
          candidate_email,
        },
      ],
    };

    return await this.makeRequest(`/mailbox/send`, {
      method: "POST",
      body: body,
    });
  }

  async updateProfileFieldSingleLine(
    candidate: Candidate,
    field: CandidateSingleLineField,
    content: string[],
  ) {
    const formattedContent = content.map((item) => {
      return { text: item };
    });

    if (field.values.length == 0) {
      field.values.push(formattedContent[0]);
    } else {
      field.values[0].text = formattedContent[0].text; // FIXME: allow multiple content strings to be entered
    }

    const body = { field: field };
    const fieldExists = field.id !== null;

    if (fieldExists) {
      await this.makeRequest(
        `/custom_fields/candidates/${candidate.id.toString()}/fields/${field.id.toString()}`,
        { method: "PATCH", body },
      );
    } else {
      await this.makeRequest(
        `/custom_fields/candidates/${candidate.id.toString()}/fields`,
        { method: "POST", body },
      );
    }
  }

  async clearProfileField(candidate: Candidate, field: CandidateField) {
    console.log(
      `[Recruitee] Clearing profile field '${field.name}' for candidate ${candidate.id}`,
    );
    await this.makeRequest(
      `/custom_fields/candidates/${candidate.id.toString()}/fields/${field.id.toString()}`,
      { method: "DELETE" },
    );
  }

  getSignature(candidate: Candidate, references: CandidateReference[]): string {
    const signatureOverride = candidate.fields.find(
      (field) => field.name == "Unterschrift Override",
    );

    if (signatureOverride && isSingleLineField(signatureOverride)) {
      const overrideNames = signatureOverride.values.map((value) => value.text);
      if (overrideNames.length > 0) {
        return this.buildSignatureFromNames(overrideNames);
      }
    }

    const subscribedPersons = references.filter(
      (reference: CandidateReference) => reference.type == ADMIN_REFERENCE_TYPE, // Check if reference is subscribed Person
    );

    if (subscribedPersons.length > 0) {
      const firstNames = subscribedPersons.map((person) => person.first_name!);
      return this.buildSignatureFromNames(firstNames);
    }
    return DEFAULT_SIGNATURE;
  }

  async proceedCandidateToStage(
    candidate: Candidate,
    stageToProceed: string,
  ): Promise<void> {
    const placement = candidate.placements[0];
    const proceedStages = await this.getStagesByName(
      stageToProceed,
      candidate.placements[0].offer_id,
    );
    const stageId = proceedStages[0].id;

    const queryParams = {
      // deno-lint-ignore camelcase
      stage_id: stageId,
      proceed: "true",
    };

    await this.makeRequest(`/placements/${placement.id}/change_stage`, {
      method: "PATCH",
      queryParams,
    });
  }

  async getStagesByName(
    stageName: string,
    offerId: number,
  ): Promise<StageDetail[]> {
    const queryParams = {
      scope: "not_archived",
      // deno-lint-ignore camelcase
      view_mode: "default",
    };

    const { offers } = await this.makeRequest<{ offers: Offer[] }>(`/offers`, {
      method: "GET",
      queryParams,
    });

    const offer = offers.filter((offer: Offer) => {
      return offer.id == offerId;
    })[0];

    const matchedStages = offer.pipeline_template.stages.filter(
      (stage: StageDetail) => {
        const searchedName = stageName.replace(/ /g, "").toLowerCase();
        const givenName = stage.name.replace(/ /g, "").toLowerCase();
        return givenName.includes(searchedName);
      },
    );

    return matchedStages;
  }

  getFieldByName(candidate: Candidate, fieldName: string): CandidateField {
    const fieldsWithName = candidate.fields.filter(
      (field) => field.name == fieldName,
    );

    return fieldsWithName[0];
  }

  public async getCandidateByGitLabRepoUrl(
    url: string,
  ): Promise<Candidate | undefined> {
    const candidates = await this.getAllQualifiedCandidates();

    return candidates.find((candidate) => {
      const field = this.getFieldByName(candidate, GITLAB_REPO_FIELD_NAME);
      if (!isSingleLineField(field)) {
        console.warn(
          `[Bot] ${GITLAB_REPO_FIELD_NAME} field exists, but is not of type 'single line' for candidate ${candidate.id}`,
        );
      }
      return (field as CandidateSingleLineField).values[0].text === url;
    });
  }

  public async getAllQualifiedCandidates(): Promise<Candidate[]> {
    const offers = await this.getOffersWithTag(OFFER_BOT_TAG);

    const candidates = await this.getAllCandidatesForOffers(offers);

    return await Promise.all(
      candidates.map((candidate) => this.getCandidateWithDetails(candidate.id)),
    );
  }

  public getProfileFieldByName(
    candidate: Candidate,
    name: string,
  ): CandidateField | undefined {
    return candidate.fields.find(
      (field) => field.name === name,
    );
  }

  private buildSignatureFromNames(names: string[]): string {
    if (names.length > 1) {
      // deno-lint-ignore no-inner-declarations
      var signature = names.pop() + " und " + names.pop();
      names.forEach((name) => {
        signature = name + ", " + signature;
      });
      return signature + " von den hacking talents";
    }
    return names[0] + " von den hacking talents";
  }
}