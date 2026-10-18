/** Read-only display taxonomy; personal tags and categories remain separately editable. */
export interface RecordFacets {
  types: string[];
  purposes: Record<string, string[]>;
  summon: string[];
  attribute: string[];
  cardType: string[];
  level: string[];
  animation: string[];
  confirmation: string[];
  displayForm: string;
}
