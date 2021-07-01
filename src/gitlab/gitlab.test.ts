import {
  assert,
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.100.0/testing/asserts.ts";
import { withMockedFetch } from "../http/http.test.ts";
import { calculateDueDate } from "../tools.ts";
import Gitlab from "./gitlab.ts";
import { Branch, GitlabProject, ImportStatus } from "./types.ts";

const gitlab = () =>
  new Gitlab(
    "gitlabToken",
    "templateNamespace",
    "homeworkNamespace",
    "webhookUrl",
  );

Deno.test("getHomeworkProject makes correct api call", async () => {
  await withMockedFetch(
    (input, init) => {
      assertEquals(
        input,
        `${Gitlab.BASE_URL}/groups/templateNamespace/projects?search=b`,
      );
      assertEquals(init?.method, "GET");
      const body: GitlabProject[] = [
        {
          name: "a",
          id: "idA",
          web_url: "",
        },
        {
          name: "b",
          id: "idB",
          web_url: "",
        },
      ];
      return new Response(JSON.stringify(body));
    },
    async () => {
      const project = await gitlab().getHomeworkProject("b");
      assertEquals(project?.name, "b");
    },
  );
});

Deno.test("waitForForkFinish makes correct api call", async () => {
  await withMockedFetch(
    (input, init) => {
      assertEquals(input, `${Gitlab.BASE_URL}/projects/forkId/import`);
      assertEquals(init?.method, "GET");
      console.log(input);

      const body: ImportStatus = { import_status: "finished" };
      return new Response(JSON.stringify(body));
    },
    async () => {
      await gitlab().waitForForkFinish("forkId");
    },
  );
});

Deno.test("waitForForkFinish retries", async () => {
  let retryCount = 0;
  await withMockedFetch(
    () => {
      retryCount += 1;

      const body: ImportStatus = { import_status: "started" };
      return new Response(JSON.stringify(body));
    },
    async () => {
      await assertThrowsAsync(() => gitlab().waitForForkFinish("forkId"));
    },
  );

  assert(retryCount > 1);
});

Deno.test("waitForForkFinish resolves", async () => {
  let retryCount = 0;
  await withMockedFetch(
    () => {
      retryCount += 1;

      const body: ImportStatus = {
        import_status: retryCount > 5 ? "finished" : "started",
      };
      return new Response(JSON.stringify(body));
    },
    async () => {
      await gitlab().waitForForkFinish("forkId");
    },
  );
});

Deno.test("getBranches makes correct api call", async () => {
  await withMockedFetch(
    (input, init) => {
      assertEquals(input, `${Gitlab.BASE_URL}/projects/id/repository/branches`);
      assertEquals(init?.method, "GET");
      const body: Branch[] = [{ name: "main", protected: true, default: true }];
      return new Response(JSON.stringify(body));
    },
    async () => {
      const branches = await gitlab().getBranches({
        name: "name",
        id: "id",
        web_url: "",
      });
      assertEquals(branches, [{
        name: "main",
        protected: true,
        default: true,
      }]);
    },
  );
});

Deno.test("addMaintainerToProject makes correct api call", async () => {
  await withMockedFetch(
    (_, init) => {
      assertEquals(
        init?.body,
        JSON.stringify({
          id: "projectId",
          user_id: "userId",
          access_level: 30,
          expires_at: "2000-02-01",
        }),
      );
      return new Response();
    },
    async () => {
      const gitlab = new Gitlab(
        "gitlabToken",
        "templateNamespace",
        "homeworkNamespace",
        "webhookUrl",
      );
      await gitlab.addMaintainerToProject(
        "projectId",
        "userId",
        calculateDueDate(new Date(2000, 1, 1)),
      );
    },
  );
});