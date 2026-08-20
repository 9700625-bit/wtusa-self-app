/** Celebration stages (PLACED, DS-2019 ISSUED, VISA APPROVED, READY TO FLY) get
 * the full-screen takeover instead of the regular Status Detail screen. */
export function stageRoute(stage) {
  return stage.celebration ? `celebration/${stage.id}` : `status/${stage.id}`;
}
