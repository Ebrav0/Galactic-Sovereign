/**
 * @typedef {Object} TutorialStep
 * @property {string} id
 * @property {string} module
 * @property {string} title
 * @property {string} objective
 * @property {string} why
 * @property {string} expected
 * @property {string} recovery
 * @property {string=} input
 * @property {string=} controlActionId
 * @property {string=} uiTargetId
 */

/**
 * @typedef {Object} TutorialCourse
 * @property {string} id
 * @property {number} version
 * @property {'solo'|'coop'|'chapter'} mode
 * @property {string} title
 * @property {readonly TutorialStep[]} steps
 */

/**
 * @typedef {Object} TutorialProgress
 * @property {'not_started'|'in_progress'|'completed'|'waived'} status
 * @property {string|null} currentStepId
 * @property {string[]} completedStepIds
 * @property {number|null} updatedAt
 */

export function defineTutorialCourse({ id, version, mode, title, steps }) {
  if (!id || !Number.isInteger(version) || !Array.isArray(steps)) {
    throw new TypeError('Invalid tutorial course');
  }
  const ids = new Set();
  const normalized = steps.map((step, index) => {
    if (!step?.id || ids.has(step.id)) throw new TypeError(`Invalid tutorial step at ${index}`);
    ids.add(step.id);
    return Object.freeze({
      module: 'Training',
      why: '',
      expected: '',
      recovery: 'Replay this step from Controls & Tutorials.',
      ...step,
    });
  });
  return Object.freeze({
    id,
    version,
    mode,
    title,
    steps: Object.freeze(normalized),
  });
}

export function tutorialProgressSnapshot(course, stepIndex, completedStepIds = []) {
  return {
    courseId: course.id,
    version: course.version,
    stepIndex,
    totalSteps: course.steps.length,
    currentStepId: course.steps[stepIndex]?.id ?? null,
    completedStepIds: [...completedStepIds],
    percent: course.steps.length
      ? Math.round((Math.min(course.steps.length, completedStepIds.length) / course.steps.length) * 100)
      : 100,
  };
}
