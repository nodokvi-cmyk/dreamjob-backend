import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export const MatchesField =
  (property: string, validationOptions?: ValidationOptions) =>
  (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'matchesField',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          return value === Reflect.get(args.object, property);
        },
        defaultMessage(): string {
          return `${propertyName} must match ${property}`;
        },
      },
    });
  };
