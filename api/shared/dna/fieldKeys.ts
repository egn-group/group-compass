// Maps DnaField (the enum used by Comment/AiConversationTurn/Group.approvedFields)
// onto the property names Group and DnaContent actually use for each field's
// text, and a human-readable label for AI prompt content. One place to keep
// these three in sync, shared by every Chair-review endpoint that needs it.
import type { DnaFieldValue } from '../../../shared/schemas/dna'

export const DNA_FIELD_KEY = {
  GroupProfile: 'groupProfile',
  MemberProfile: 'memberProfile',
  CompaniesProfile: 'companiesProfile',
} as const satisfies Record<DnaFieldValue, 'groupProfile' | 'memberProfile' | 'companiesProfile'>

export const DNA_FIELD_LABEL: Record<DnaFieldValue, string> = {
  GroupProfile: 'Group Profile',
  MemberProfile: 'Member Profile',
  CompaniesProfile: 'Companies Profile',
}

export const ALL_DNA_FIELDS: DnaFieldValue[] = ['GroupProfile', 'MemberProfile', 'CompaniesProfile']
