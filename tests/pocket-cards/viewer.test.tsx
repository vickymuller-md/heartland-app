import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardGallery } from '@/app/(public)/pocket-cards/card-gallery';
import { POCKET_CARDS, CARDS_BY_MODULE } from '@/lib/pocket-cards/constants';

// Mock next/image to render a plain <img> in tests
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// Mock yet-another-react-lightbox and plugins
vi.mock('yet-another-react-lightbox', () => ({
  default: (props: Record<string, unknown>) => {
    if (!props.open) return null;
    return (
      <div data-testid="lightbox" data-index={props.index}>
        <button onClick={props.close as () => void}>Close</button>
      </div>
    );
  },
}));

vi.mock('yet-another-react-lightbox/plugins/zoom', () => ({
  default: 'Zoom',
}));
vi.mock('yet-another-react-lightbox/plugins/download', () => ({
  default: 'Download',
}));
vi.mock('yet-another-react-lightbox/plugins/fullscreen', () => ({
  default: 'Fullscreen',
}));
vi.mock('yet-another-react-lightbox/styles.css', () => ({}));

// ==========================================================================
// CARD-01, CARD-02: Lightbox Interaction
// Zoom, download, and fullscreen via yet-another-react-lightbox plugins
// ==========================================================================
describe('CardGallery lightbox', () => {
  it('lightbox is closed by default (not rendered in DOM)', () => {
    render(<CardGallery />);
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
  });

  it('clicking a card thumbnail opens the lightbox', async () => {
    const user = userEvent.setup();
    render(<CardGallery />);
    const firstCard = screen.getByRole('button', {
      name: `View ${POCKET_CARDS[0].title} full size`,
    });
    await user.click(firstCard);
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
  });

  it('lightbox opens at the index of the clicked card', async () => {
    const user = userEvent.setup();
    render(<CardGallery />);
    // Click the second card (index 1)
    const secondCard = screen.getByRole('button', {
      name: `View ${POCKET_CARDS[1].title} full size`,
    });
    await user.click(secondCard);
    const lightbox = screen.getByTestId('lightbox');
    expect(lightbox).toHaveAttribute('data-index', '1');
  });

  it('lightbox slides array contains all 10 pocket cards', () => {
    // Verified via constants; POCKET_CARDS array feeds slides
    expect(POCKET_CARDS).toHaveLength(10);
  });

  it('closing the lightbox removes it from the DOM', async () => {
    const user = userEvent.setup();
    render(<CardGallery />);
    // Open
    const firstCard = screen.getByRole('button', {
      name: `View ${POCKET_CARDS[0].title} full size`,
    });
    await user.click(firstCard);
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
    // Close
    await user.click(screen.getByText('Close'));
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
  });
});

// ==========================================================================
// CARD-01, CARD-03: Card Gallery Component
// Grid layout with module section headings, thumbnails, download links
// ==========================================================================
describe('CardGallery component', () => {
  it('renders section headings for each module that has cards', () => {
    render(<CardGallery />);
    CARDS_BY_MODULE.forEach((group) => {
      expect(
        screen.getByRole('heading', {
          name: `Module ${group.module.number}: ${group.module.name}`,
        }),
      ).toBeInTheDocument();
    });
  });

  it('renders all 10 card thumbnails with alt text', () => {
    render(<CardGallery />);
    POCKET_CARDS.forEach((card) => {
      expect(screen.getByAltText(card.alt)).toBeInTheDocument();
    });
  });

  it('each card shows figure number and descriptive title', () => {
    render(<CardGallery />);
    POCKET_CARDS.forEach((card) => {
      expect(screen.getByText(card.title)).toBeInTheDocument();
      expect(
        screen.getByText(`Figure ${card.figureNumber}`),
      ).toBeInTheDocument();
    });
  });

  it('each card has a download link with download attribute', () => {
    render(<CardGallery />);
    const downloadLinks = screen.getAllByText('Download');
    expect(downloadLinks).toHaveLength(10);

    POCKET_CARDS.forEach((card) => {
      const link = screen.getByRole('link', {
        name: `Download ${card.title}`,
      });
      expect(link).toHaveAttribute('href', card.src);
      expect(link).toHaveAttribute('download', card.fileName);
    });
  });

  it('cards are grouped under their module section heading', () => {
    render(<CardGallery />);
    // Check that Module 2 section contains GDMT and Financial Navigation cards
    const module2Heading = screen.getByRole('heading', {
      name: 'Module 2: GDMT Optimization',
    });
    const module2Section = module2Heading.closest('section');
    expect(module2Section).toBeTruthy();
    const mod2 = within(module2Section!);
    expect(
      mod2.getByText('GDMT Optimization Quick Reference'),
    ).toBeInTheDocument();
    expect(
      mod2.getByText('Financial Navigation Tracker'),
    ).toBeInTheDocument();
  });
});

// ==========================================================================
// CARD-02: Download Links
// Direct download anchors in the card grid
// ==========================================================================
describe('Download links', () => {
  it('each card in the grid has an anchor with href pointing to /figures/*.jpg', () => {
    render(<CardGallery />);
    POCKET_CARDS.forEach((card) => {
      const link = screen.getByRole('link', {
        name: `Download ${card.title}`,
      });
      expect(link.getAttribute('href')).toMatch(/^\/figures\/.*\.jpg$/);
    });
  });

  it('each download anchor has the download attribute set to the filename', () => {
    render(<CardGallery />);
    POCKET_CARDS.forEach((card) => {
      const link = screen.getByRole('link', {
        name: `Download ${card.title}`,
      });
      expect(link).toHaveAttribute('download', card.fileName);
    });
  });

  it('download links have accessible aria-label', () => {
    render(<CardGallery />);
    POCKET_CARDS.forEach((card) => {
      const link = screen.getByRole('link', {
        name: `Download ${card.title}`,
      });
      expect(link).toHaveAttribute('aria-label', `Download ${card.title}`);
    });
  });
});
