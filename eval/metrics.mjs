export function summarizeTrace(
  events,
  { mode, elapsedMs, inputPrice, outputPrice },
) {
  const starts = new Map(
    events.filter((e) => e.event === 'start').map((e) => [e.spanId, e]),
  );
  const ends = events.filter((e) => e.event === 'end');
  const models = ends.filter((e) => e.kind === 'model');
  const calls = events.filter(
    (e) => e.kind === 'model' && e.event === 'start',
  ).length;
  const live = models.filter((e) => e.backend === 'live');
  const liveCalls = events.filter(
    (e) => e.kind === 'model' && e.event === 'start' && e.backend === 'live',
  ).length;
  const usageComplete =
    mode === 'live' &&
    liveCalls === live.length &&
    live.every(
      (e) =>
        e.usage?.prompt_tokens !== undefined &&
        e.usage?.completion_tokens !== undefined,
    );
  const promptTokens = usageComplete
    ? live.reduce((n, e) => n + e.usage.prompt_tokens, 0)
    : null;
  const completionTokens = usageComplete
    ? live.reduce((n, e) => n + e.usage.completion_tokens, 0)
    : null;
  const durations = (kind) =>
    ends
      .filter((e) => e.kind === kind)
      .map((e) => ({
        status: e.status,
        durationMs: e.atMs - starts.get(e.spanId).atMs,
      }));
  const firstTextMs = events
    .filter((e) => e.event === 'start' && e.kind === 'turn')
    .map((turn) => {
      const first = events.find(
        (e) => e.event === 'first_text' && e.parentId === turn.spanId,
      );
      return first ? first.atMs - turn.atMs : null;
    });
  const turns = durations('turn');
  // Retain these legacy report fields for comparisons with the retired extractor.
  const backgroundModels = models.filter(
    (model) => starts.get(model.parentId)?.kind === 'extraction',
  );
  const answer = turns.at(-1);
  return {
    elapsedMs,
    answerLatencyMs: answer?.status === 'ok' ? answer.durationMs : null,
    modelCalls: mode === 'device' ? null : calls,
    liveModelCalls: mode === 'device' ? null : liveCalls,
    scriptedModelCalls: mode === 'device' ? null : calls - liveCalls,
    failedModelCalls:
      mode === 'device' ? null : models.filter((e) => e.status !== 'ok').length,
    unfinishedModelCalls: mode === 'device' ? null : calls - models.length,
    backgroundModelCalls: mode === 'device' ? null : backgroundModels.length,
    toolCalls:
      mode === 'device'
        ? null
        : events.filter((e) => e.kind === 'tool' && e.event === 'start').length,
    failedToolCalls:
      mode === 'device'
        ? null
        : ends.filter((e) => e.kind === 'tool' && e.status !== 'ok').length,
    inputChars:
      mode === 'device'
        ? null
        : models.reduce((n, e) => n + (e.inputChars ?? 0), 0),
    promptTokens,
    completionTokens,
    estimatedCostUSD:
      usageComplete && inputPrice !== undefined && outputPrice !== undefined
        ? (promptTokens * inputPrice + completionTokens * outputPrice) / 1e6
        : null,
    firstTextMs,
    turns,
    extractions: durations('extraction'),
    checkpoints: durations('checkpoint'),
  };
}

export function aggregate(results) {
  const groups = Map.groupBy(
    results,
    (r) => `${r.suite}/${r.id}/${r.mode}/${r.variant}`,
  );
  return [...groups].map(([group, rows]) => {
    const latency = rows.map((r) => r.metrics.elapsedMs).sort((a, b) => a - b);
    const answerLatency = rows
      .map((r) => r.metrics.answerLatencyMs)
      .filter((n) => typeof n === 'number')
      .sort((a, b) => a - b);
    const mean = (key) =>
      rows.every((r) => typeof r.metrics[key] === 'number')
        ? rows.reduce((n, r) => n + r.metrics[key], 0) / rows.length
        : null;
    return {
      group,
      trials: rows.length,
      passed: rows.filter((r) => r.status === 'pass').length,
      failed: rows.filter((r) => r.status === 'fail').length,
      errors: rows.filter((r) => r.status === 'error').length,
      successRate: rows.filter((r) => r.status === 'pass').length / rows.length,
      medianMs: latency[Math.ceil(latency.length * 0.5) - 1],
      answerSamples: answerLatency.length,
      medianAnswerMs: answerLatency.length
        ? answerLatency[Math.ceil(answerLatency.length * 0.5) - 1]
        : null,
      meanLiveModelCalls: mean('liveModelCalls'),
      meanInputTokens: mean('promptTokens'),
      meanCostUSD: mean('estimatedCostUSD'),
      p95Ms:
        latency.length >= 20
          ? latency[Math.ceil(latency.length * 0.95) - 1]
          : null,
    };
  });
}
