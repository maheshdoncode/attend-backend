import { ZodError } from 'zod';

export const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errorMessages = err.errors.map(
          (e) => `${e.path.join('.') || 'root'}: ${e.message}`
        ).join(', ');

        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: errorMessages,
            details: err.errors,
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid request data.',
        },
      });
    }
  };
};

export default validate;
