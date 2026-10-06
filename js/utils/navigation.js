/** Celebration stages (PLACEMENT_COMPLETED, DS-2019 ISSUED, VISA APPROVED, READY TO FLY) get
 * the full-screen takeover instead of the regular Status Detail screen.
 *
 * ТОЛЬКО ДЛЯ ДОСТИГНУТОГО ЭТАПА (05.10.2026). В «Пути» можно нажать любой этап, в том
 * числе будущий: студент на регистрации CIEE нажимал «Виза J-1 одобрена» и получал
 * поздравление во весь экран — «VISA APPROVED · Congratulations! Ваша J-1 Visa
 * одобрена». Этап, до которого студент ещё не дошёл (status "upcoming", его
 * проставляет deriveRoadmap), открывается обычным экраном этапа с пометкой
 * «Предстоит». У этапа без поля status (главная передаёт текущий) — как раньше. */
export function stageRoute(stage) {
  return stage.celebration && stage.status !== "upcoming" ? `celebration/${stage.id}` : `status/${stage.id}`;
}
