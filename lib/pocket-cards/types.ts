/**
 * Pocket Card Library -- Type Definitions
 *
 * Types for the 10 HEARTLAND Protocol reference figures (pocket cards,
 * checklists, reference cards) displayed in the /provider/pocket-cards gallery.
 */

/** Protocol module that a pocket card belongs to */
export interface CardModule {
  number: number;
  name: string;
  description: string;
}

/** Individual pocket card with full metadata */
export interface PocketCard {
  /** Unique identifier (kebab-case) */
  id: string;
  /** Figure number (1-10) */
  figureNumber: number;
  /** Human-readable title */
  title: string;
  /** Protocol module this card belongs to */
  module: CardModule;
  /** Original file name (e.g., "01_Pocket_Card_GDMT.jpg") */
  fileName: string;
  /** Public URL path (e.g., "/figures/01_Pocket_Card_GDMT.jpg") */
  src: string;
  /** Descriptive alt text for accessibility */
  alt: string;
  /** Approximate width for aspect ratio calculation */
  width: number;
  /** Approximate height for aspect ratio calculation */
  height: number;
}
