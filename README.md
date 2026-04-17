# @cboyke/demotools

Reusable React components for building commercetools demos.

## Components

### `<JsonViewer data={...} />`

A VS Code-styled, searchable, collapsible JSON tree viewer. Useful for
inspecting the live shape of any object (carts, orders, customers, etc.) in a
demo UI.

Features:
- Search (Enter / Shift+Enter to navigate matches)
- Expand all / collapse all
- Copy raw JSON to clipboard
- Auto-expand of paths containing matches
- VS Code Dark+ color palette

### `<JsonModal data={...} title="Cart JSON" />`

A trigger button that opens a fullscreen modal containing a `JsonViewer`.
Drop-in replacement for hand-rolled "show JSON" buttons in demo pages.

Props:
| Prop              | Default          | Notes                              |
|-------------------|------------------|------------------------------------|
| `data`            | (required)       | Object to render in the viewer.    |
| `title`           | `"JSON"`         | Header label inside the modal.     |
| `buttonLabel`     | `"JSON"`         | Label on the trigger button.       |
| `buttonClassName` | small slate pill | Override classes on the trigger.   |

## Installation

```bash
npm install @cboyke/demotools
```

For local development, link from a sibling checkout:

```json
{ "dependencies": { "@cboyke/demotools": "file:../demotools" } }
```

## Tailwind

The components use Tailwind utility classes. If your project is on Tailwind
v4, add a `@source` line to your CSS so the classes get scanned in
`node_modules`:

```css
@import "tailwindcss";
@source "../node_modules/@cboyke/demotools/dist/**/*.js";
```

## Usage

```tsx
import { JsonModal } from '@cboyke/demotools';

export default function CartPage({ cart }) {
  return (
    <>
      <JsonModal data={cart} title="Cart JSON" />
      {/* ...rest of page */}
    </>
  );
}
```

Both components are client-only — they include `'use client'` so they work in
Next.js App Router server components.
