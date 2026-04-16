'use client';

import { useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Download from 'yet-another-react-lightbox/plugins/download';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import 'yet-another-react-lightbox/styles.css';

import { CARDS_BY_MODULE, POCKET_CARDS } from '@/lib/pocket-cards/constants';
import { CardGridItem } from './card-grid-item';

export function CardGallery() {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Build slides array for YARL from all pocket cards (flat order matching POCKET_CARDS)
  const slides = useMemo(
    () =>
      POCKET_CARDS.map((card) => ({
        src: card.src,
        alt: card.alt,
        width: card.width,
        height: card.height,
        title: card.title,
        download: {
          url: card.src,
          filename: card.fileName,
        },
      })),
    [],
  );

  // Build a global index lookup: card id -> index in POCKET_CARDS array
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    POCKET_CARDS.forEach((card, idx) => {
      map.set(card.id, idx);
    });
    return map;
  }, []);

  const handleCardClick = (cardId: string) => {
    const idx = globalIndexMap.get(cardId) ?? 0;
    setLightboxIndex(idx);
    setLightboxOpen(true);
  };

  return (
    <>
      {/* Module-grouped card grid */}
      {CARDS_BY_MODULE.map((group) => (
        <section key={group.module.number} className="mb-8 last:mb-0">
          <h2 className="text-lg font-semibold text-gray-900">
            Module {group.module.number}: {group.module.name}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 mb-4">
            {group.module.description}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.cards.map((card) => (
              <CardGridItem
                key={card.id}
                card={card}
                onClick={() => handleCardClick(card.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* YARL Lightbox -- rendered outside grid sections */}
      <Lightbox
        open={lightboxOpen}
        close={() => setLightboxOpen(false)}
        index={lightboxIndex}
        slides={slides}
        plugins={[Zoom, Download, Fullscreen]}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
        }}
      />
    </>
  );
}
