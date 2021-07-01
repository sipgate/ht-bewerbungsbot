export interface HttpRequestOptions {
  method?: "POST" | "GET" | "DELETE" | "PATCH" | "PUT";
  queryParams?: Record<string, string>;
  body?: any;
}