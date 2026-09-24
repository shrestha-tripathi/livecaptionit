import { pseoA, type PseoEntry } from "./pseo-a";
import { pseoB } from "./pseo-b";

export type { PseoEntry };
export const pseo: PseoEntry[] = [...pseoA, ...pseoB];
export const pseoBySlug = (slug: string) => pseo.find((p) => p.slug === slug);
