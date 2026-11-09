import { registerDecorator, ValidationOptions } from 'class-validator';

export const countWords = (text: string): number => {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
};

export const MaxWords =
  (max: number, validationOptions?: ValidationOptions) =>
  (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'maxWords',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && countWords(value) <= max;
        },
        defaultMessage(): string {
          return `${propertyName} must not be longer than ${max} words`;
        },
      },
    });
  };
