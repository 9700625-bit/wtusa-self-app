/**
 * Pure functions that turn a flat "state" snapshot — the same shape whether
 * it came from mockData.js (Phase 1) or a live backend (js/services/liveApi.js)
 * — into the richer view-models each screen needs. Both api paths call these,
 * so mock and live behave identically and roadmap.config.js stays the ONLY
 * place stage copy/severity/CTA is defined (never duplicated backend-side).
 *
 * Expected `state` shape:
 * {
 *   participant, coordinator, currentStageId,
 *   documents: [{id,type,status,updatedAt,note,coordinatorComment}],
 *   payments: [{id,label,amount,deadline,status,paidDate}],
 *   programCost, visaFees: [{id,label,amount,status}],
 *   briefings: [{id,title,description,date,time,status,link,materials}],
 *   visaInfo: {appointmentDate,appointmentTime,location,result,passportStatus},
 *   preDepartureChecklist: [{id,label,done}],
 * }
 */

import {
  getStage,
  getStagesByGroup,
  stageStatus,
  computeProgress,
  nextStage,
  GROUPS,
} from "../config/roadmap.config.js";
import { daysUntil } from "../utils/format.js?v=2";

// Falls back to the very first stage if the backend ever sends a
// currentStageId that doesn't match any known stage (e.g. a stale/unmapped
// amoCRM status) — better to show something than to hard-crash the screen.
function safeCurrentStage_(currentStageId) {
  return getStage(currentStageId) || getStage("CONTRACT_SIGNED");
}

export function deriveActionCard(state) {
  const stage = safeCurrentStage_(state.currentStageId);
  if (!stage) return null;
  return {
    stageId: stage.id,
    actionRequired: stage.actionRequired,
    title: stage.actionRequired ? stage.title : "Сейчас от вас ничего не требуется",
    description: stage.description,
    severity: stage.severity,
    cta: stage.cta,
  };
}

function nearestPayment(state) {
  const upcoming = (state.payments || [])
    .filter((p) => p.status === "awaiting" || p.status === "overdue")
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  return upcoming[0] || null;
}

function nearestBriefing(state) {
  const upcoming = (state.briefings || []).filter((b) => b.status === "upcoming" && b.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  return upcoming[0] || (state.briefings || []).find((b) => b.status === "upcoming") || null;
}

export function deriveDashboard(state) {
  const stage = safeCurrentStage_(state.currentStageId);
  return {
    participant: state.participant,
    currentStage: stage,
    progress: computeProgress(state.currentStageId),
    action: deriveActionCard(state),
    nearestPayment: nearestPayment(state),
    nearestBriefing: nearestBriefing(state),
  };
}

export function deriveRoadmap(state) {
  const groups = GROUPS.map((g) => ({
    ...g,
    stages: getStagesByGroup(g.id).map((s) => ({ ...s, status: stageStatus(s.id, state.currentStageId) })),
  }));
  return { currentStageId: state.currentStageId, progress: computeProgress(state.currentStageId), groups };
}

export function deriveStageDetail(state, stageId) {
  const stage = getStage(stageId);
  if (!stage) return null;
  return {
    stage,
    status: stageStatus(stageId, state.currentStageId),
    isCurrentStage: stageId === state.currentStageId,
    next: nextStage(stageId),
  };
}

export function derivePayments(state) {
  // Only USD-denominated payments count toward the top "Оплачено" figure —
  // Payment 1 is pure KZT with no $ amount, so it can't be summed in.
  const paidTotal = (state.payments || [])
    .filter((p) => p.status === "paid" && (p.currency || "USD") === "USD")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const currentOrder = safeCurrentStage_(state.currentStageId).order;
  return {
    paidTotal,
    programCost: state.programCost,
    payments: (state.payments || []).map((p) => ({ ...p, daysUntilDeadline: daysUntil(p.deadline) })),
    visaFees: state.visaFees,
    visaFeesUnlocked: currentOrder >= getStage("DS2019_ISSUED").order,
  };
}
