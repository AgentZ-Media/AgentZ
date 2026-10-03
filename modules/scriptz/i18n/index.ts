// The product translator composes its catalog with the shared Kit labels.
// Language state and formatting belong to Kit; importing this file is pure.
import { createModuleI18n } from "@agentz/kit/i18n";
import { de } from "./de";
import { en } from "./en";

export const scriptzCatalogs = { de, en };
export const { t, tPlural } = createModuleI18n(scriptzCatalogs);
export type TranslationKey = Parameters<typeof t>[0];
