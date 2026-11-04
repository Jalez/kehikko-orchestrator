import { PERSON_MESSAGES_SETTING, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

/**
 * The one setting: whether what the person types or presses here goes to agent sessions as THEIR
 * instruction (protocol 2.50.0, `messages.say`). Off by default, the person's alone, kept on this
 * machine. Kehikot sends nothing as the person until it has itself seen them turn this on in its
 * Settings › Modules: a value written into the file by anyone else grants nothing.
 */
export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([PERSON_MESSAGES_SETTING])
