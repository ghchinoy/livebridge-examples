import type { DetailedHTMLProps, HTMLAttributes, KeyboardEvent } from 'react';
import type { LustrousBadge } from '@ghchinoy/lustrous-lit/components/lustrous-badge';
import type { LustrousBanner } from '@ghchinoy/lustrous-lit/components/lustrous-banner';
import type { LustrousBox } from '@ghchinoy/lustrous-lit/components/lustrous-box';
import type { LustrousButton } from '@ghchinoy/lustrous-lit/components/lustrous-button';
import type {
  LustrousFlex,
  LustrousFlexItem,
} from '@ghchinoy/lustrous-lit/components/lustrous-flex';
import type { LustrousProgressBar } from '@ghchinoy/lustrous-lit/components/lustrous-progress-bar';
import type { LustrousProseText } from '@ghchinoy/lustrous-lit/components/lustrous-prose-text';
import type { LustrousScrollableBox } from '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import type {
  LustrousSegmentedControl,
  LustrousSegmentOption,
} from '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import type {
  LustrousSelect,
  LustrousSelectOption,
} from '@ghchinoy/lustrous-lit/components/lustrous-select';
import type { LustrousText } from '@ghchinoy/lustrous-lit/components/lustrous-text';
import type { LustrousTextInput } from '@ghchinoy/lustrous-lit/components/lustrous-text-input';
import type { LustrousTogglableButton } from '@ghchinoy/lustrous-lit/components/lustrous-togglable-button';
import type { LustrousChangeEvent } from '@ghchinoy/lustrous-lit/theme';

type CustomEl<E extends HTMLElement, Extra = Record<string, unknown>> =
  DetailedHTMLProps<HTMLAttributes<E> & Extra, E>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'lustrous-flex': CustomEl<
        LustrousFlex,
        {
          direction?: string;
          align?: string;
          justify?: string;
          wrap?: string;
          gap?: string;
          padding?: string;
          'mobile-padding'?: string;
          'max-width'?: string;
          'margin-inline'?: string;
          background?: string;
          border?: boolean | string;
          'border-radius'?: string;
          shadow?: string;
        }
      >;
      'lustrous-flex-item': CustomEl<
        LustrousFlexItem,
        { grow?: string; 'min-width'?: string }
      >;
      'lustrous-box': CustomEl<
        LustrousBox,
        {
          padding?: string;
          'padding-inline'?: string;
          background?: string;
          border?: boolean | string;
          'border-radius'?: string;
          width?: string;
          overflow?: string;
          'data-theme'?: string;
        }
      >;
      'lustrous-text': CustomEl<
        LustrousText,
        { variant?: string; heading?: string; muted?: boolean; tone?: string }
      >;
      'lustrous-prose-text': CustomEl<
        LustrousProseText,
        { variant?: string; language?: string; block?: boolean; muted?: boolean }
      >;
      'lustrous-badge': CustomEl<
        LustrousBadge,
        { tone?: string; icon?: string }
      >;
      'lustrous-banner': CustomEl<
        LustrousBanner,
        { variant?: string; icon?: string; layout?: string; description?: string }
      >;
      'lustrous-button': CustomEl<
        LustrousButton,
        {
          variant?: string;
          size?: string;
          icon?: string;
          disabled?: boolean;
          type?: string;
        }
      >;
      'lustrous-togglable-button': CustomEl<
        LustrousTogglableButton,
        {
          size?: string;
          icon?: string;
          selected?: boolean;
          disabled?: boolean;
          'onlustrous-change'?: (e: LustrousChangeEvent) => void;
        }
      >;
      'lustrous-select': CustomEl<
        LustrousSelect,
        {
          label?: string;
          size?: string;
          value?: string;
          options?: readonly LustrousSelectOption[];
          disabled?: boolean;
          'onlustrous-change'?: (e: LustrousChangeEvent) => void;
        }
      >;
      'lustrous-segmented-control': CustomEl<
        LustrousSegmentedControl,
        {
          size?: string;
          label?: string;
          value?: string;
          options?: readonly LustrousSegmentOption[];
          'onlustrous-change'?: (e: LustrousChangeEvent) => void;
        }
      >;
      'lustrous-scrollable-box': CustomEl<
        LustrousScrollableBox,
        {
          scrim?: string;
          label?: string;
          background?: string;
          border?: boolean | string;
          'border-radius'?: string;
          padding?: string;
        }
      >;
      'lustrous-text-input': CustomEl<
        LustrousTextInput,
        {
          size?: string;
          value?: string;
          placeholder?: string;
          disabled?: boolean;
          onInput?: (e: Event) => void;
          onKeyDown?: (e: KeyboardEvent<LustrousTextInput>) => void;
        }
      >;
      'lustrous-progress-bar': CustomEl<
        LustrousProgressBar,
        {
          value?: number;
          tone?: string;
          label?: string;
          decorative?: boolean;
        }
      >;
    }
  }
}
