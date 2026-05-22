import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The one utility that unites all Tailwind class warriors.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
