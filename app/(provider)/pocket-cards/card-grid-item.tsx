'use client';

import Image from 'next/image';
import { Download } from 'lucide-react';
import type { PocketCard } from '@/lib/pocket-cards/types';

interface CardGridItemProps {
  card: PocketCard;
  onClick: () => void;
}

export function CardGridItem({ card, onClick }: CardGridItemProps) {
  return (
    <div className="group rounded-lg border border-gray-200 bg-white overflow-hidden transition-shadow hover:shadow-md">
      {/* Clickable thumbnail */}
      <button
        type="button"
        className="w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        onClick={onClick}
        aria-label={`View ${card.title} full size`}
      >
        <div className="relative aspect-video bg-gray-100">
          <Image
            src={card.src}
            alt={card.alt}
            width={card.width}
            height={card.height}
            loading="lazy"
            className="object-contain w-full h-full"
          />
        </div>
      </button>

      {/* Card info */}
      <div className="p-3">
        <p className="text-sm font-medium text-gray-900 leading-tight">
          {card.title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Figure {card.figureNumber}
        </p>
        <span className="mt-1.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          Module {card.module.number}: {card.module.name}
        </span>

        {/* Download link */}
        <div className="mt-2 border-t border-gray-100 pt-2">
          <a
            href={card.src}
            download={card.fileName}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
            aria-label={`Download ${card.title}`}
          >
            <Download className="size-3.5" />
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
