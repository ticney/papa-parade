/**
 * The few colours of the provisional 3D scene, as `0xRRGGBB`. Copied from the `colors` of the
 * DESIGN.md frontmatter (the UX spec is the source of truth); three treats them as sRGB.
 */
export const PALETTE = {
  /** DESIGN.md `colors.cream` (#FFF4E3). */
  cream: 0xfff4e3,
  /** DESIGN.md `colors.ink` (#2A2140). */
  ink: 0x2a2140,
  /** DESIGN.md `colors.paper` (#FFFFFF). */
  paper: 0xffffff,
  /** DESIGN.md `colors.primary` (#6D3FE0). */
  primary: 0x6d3fe0,
} as const;
