import { z } from 'zod';
import { a } from '@shared/a';

export const schema = z.number().default(a);
