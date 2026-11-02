import { TransformFnParams } from 'class-transformer';

export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const trimEach = ({ value }: TransformFnParams): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;

export const toTrimmedList = ({ value }: TransformFnParams): unknown => {
  const items: unknown = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items)) return items;

  return items.map((item: unknown) =>
    typeof item === 'string' ? item.trim() : item,
  );
};

export const trimLowercase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
