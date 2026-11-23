import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { handlers, setUploadRejects } from "./handlers";

export const mswServer = setupServer(...handlers);

beforeAll(() => mswServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
  setUploadRejects(false);
});
afterAll(() => mswServer.close());
