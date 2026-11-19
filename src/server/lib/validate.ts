import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import type { ApiErrorBody } from "../errors";

/** zValidator com o mesmo formato de erro do resto da API. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    const body: ApiErrorBody = {
      error: {
        code: "invalid_input",
        message: z.prettifyError(result.error),
        issues: result.error.issues,
      },
    };
    return c.json(body, 400);
  });
}
