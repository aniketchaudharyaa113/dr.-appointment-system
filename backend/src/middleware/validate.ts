import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

interface RequestValidators {
  body?: ZodSchema<any>;
  query?: ZodSchema<any>;
  params?: ZodSchema<any>;
}

export function validate(schemas: RequestValidators) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as any;
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as any;
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: err.issues[0]?.message || "Validation failed",
          message: "Validation failed",
          errors: err.issues,
        });
      }
      return next(err);
    }
  };
}
