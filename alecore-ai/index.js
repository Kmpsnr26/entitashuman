/**
 * AleCore AI public entry point.
 *
 * The implementation is still hosted in the legacy nara-core tree while the
 * staged migration is underway. Exporting through this facade lets first-party
 * consumers adopt the AleCore identity without breaking existing imports.
 */
export * from '../nara-core/brain/index.js';
export { NaraOrchestrator as AleCoreOrchestrator } from '../nara-core/brain/orchestrator.js';
