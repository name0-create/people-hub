// Canonical data model — import from here.
export * from "./Person";
export * from "./PersonProperty";
export * from "./Interaction";
export * from "./Meeting";
export { SchemaRegistry, personSchema, PERSON_PROPERTIES, REQUIRED_PERSON_KEYS } from "./SchemaRegistry";
// Runtime view model (parsed + computed) lives in ./person-view and is imported directly.
