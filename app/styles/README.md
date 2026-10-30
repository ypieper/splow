# Styles

`app/globals.css` is the single entry point. Its imports follow the original
cascade, including the responsive rules and later refinements. Keep this order
when changing styles; feature rules still rely on it.

- `foundation.css`: reset, Tailwind, basic layout and shared controls.
- `workspace-forms.css`, `event-layouts.css`: organizer forms and event views.
- `accounts-and-administration.css`: settings, administration and partners.
- `brand-theme.css`, `surfaces.css`: the existing visual theme.
- `landing.css`, `public-pages-and-reports.css`, `product-demo.css`: public pages,
  printable reports and the product walkthrough.
- `navigation-and-typography.css`, `responsive-workspaces.css`: navigation,
  typography and shared responsive layouts.
- `sponsor-workspace.css`, `sponsor-tasks.css`: sponsor views and task cards.
- `task-workflows.css`, `workflow-builder.css`: fulfillment and workflow editing.
- `badges-and-lists.css`, `adaptive-tables.css`, `compact-layouts.css`: shared
  list patterns and compact layouts.
- `liquid-glass.css`: translucent treatment for sticky navigation and floating
  controls; imported last so the effect stays scoped to those surfaces.

Edit the file that owns the affected rule. Prefer shared controls and existing
variables over adding another global override. The initial extraction preserves
the stylesheet byte for byte when the imported files are concatenated.
