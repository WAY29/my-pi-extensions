/**
 * AskUserQuestion Tool - Unified tool for asking single or multiple questions
 *
 * Single question: simple options list
 * Multiple questions: tab bar with arrow navigation between questions
 * Tab on an option opens a Codex-style note editor for that option
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { withSupersetAttention } from "./superset-hooks/attention";

// Types
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface RawQuestionOption {
	value?: string;
	label: string;
	description?: string;
}

interface RawQuestion {
	id: string;
	label?: string;
	header?: string;
	prompt?: string;
	question?: string;
	options?: RawQuestionOption[] | null;
	allowOther?: boolean;
	isOther?: boolean;
	is_other?: boolean;
	isSecret?: boolean;
	is_secret?: boolean;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
	id: string;
	label: string;
	prompt: string;
	options: QuestionOption[];
	allowOther: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
	note?: string;
	/** Codex request_user_input style answer vector. */
	answers: string[];
}

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

// Schema
const QuestionOptionSchema = Type.Object({
	value: Type.Optional(Type.String({ description: "The value returned when selected (defaults to label)" })),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(
		Type.String({
			description: "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
		}),
	),
	header: Type.Optional(Type.String({ description: "Codex-style short tab/header label (alias for label)" })),
	prompt: Type.Optional(Type.String({ description: "The full question text to display" })),
	question: Type.Optional(Type.String({ description: "Codex-style question text (alias for prompt)" })),
	options: Type.Optional(
		Type.Union([Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }), Type.Null()]),
	),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow 'Type something' option (default: true)" })),
	isOther: Type.Optional(Type.Boolean({ description: "Codex-style alias for allowOther" })),
	is_other: Type.Optional(Type.Boolean({ description: "Snake-case alias for allowOther" })),
	isSecret: Type.Optional(Type.Boolean({ description: "Codex-style flag for secret input (currently rendered as normal text)" })),
	is_secret: Type.Optional(Type.Boolean({ description: "Snake-case alias for isSecret" })),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask the user" }),
});

function errorResult(
	message: string,
	questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

export default function askUserQuestion(pi: ExtensionAPI) {
	pi.registerTool({
		name: "AskUserQuestion",
		label: "Ask User Question",
		description:
			"Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. Press Tab on an option to let the user attach a note to that option.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			// Normalize questions with defaults and Codex-style aliases.
			const questions: Question[] = (params.questions as RawQuestion[]).map((q, i) => ({
				id: q.id,
				label: q.label || q.header || `Q${i + 1}`,
				prompt: q.prompt || q.question || "",
				options: (q.options || []).map((opt) => ({
					value: opt.value || opt.label,
					label: opt.label,
					description: opt.description,
				})),
				allowOther: q.allowOther ?? q.isOther ?? q.is_other ?? true,
			}));

			if (questions.some((q) => !q.prompt.trim())) {
				return errorResult("Error: Each question must include prompt or question text", questions);
			}
			if (questions.some((q) => q.options.length === 0 && !q.allowOther)) {
				return errorResult("Error: Each question must include options or allowOther/isOther", questions);
			}

			const isMulti = questions.length > 1;
			const totalTabs = questions.length + 1; // questions + Submit

			const result = await withSupersetAttention(pi, "AskUserQuestion", () =>
				ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
				// State
				let currentTab = 0;
				let optionIndex = 0;
				let inputMode: "other" | "note" | null = null;
				let inputQuestionId: string | null = null;
				let noteOption: { value: string; label: string; index: number } | null = null;
				let cachedLines: string[] | undefined;
				let cachedWidth: number | undefined;
				const answers = new Map<string, Answer>();

				// Shared editor for "Type something" and option notes
				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				// Helpers
				function refresh() {
					cachedLines = undefined;
					cachedWidth = undefined;
					tui.requestRender();
				}

				function submit(cancelled: boolean) {
					done({ questions, answers: Array.from(answers.values()), cancelled });
				}

				function currentQuestion(): Question | undefined {
					return questions[currentTab];
				}

				function currentOptions(): RenderOption[] {
					const q = currentQuestion();
					if (!q) return [];
					const opts: RenderOption[] = [...q.options];
					if (q.allowOther) {
						opts.push({ value: "__other__", label: "Type something.", isOther: true });
					}
					return opts;
				}

				function allAnswered(): boolean {
					return questions.every((q) => answers.has(q.id));
				}

				function advanceAfterAnswer() {
					if (!isMulti) {
						submit(false);
						return;
					}
					if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = questions.length; // Submit tab
					}
					optionIndex = 0;
					refresh();
				}

				function saveAnswer(
					questionId: string,
					value: string,
					label: string,
					wasCustom: boolean,
					index?: number,
					note?: string,
				) {
					const trimmedNote = note?.trim();
					const answerVector = [label];
					if (trimmedNote) answerVector.push(`user_note: ${trimmedNote}`);
					answers.set(questionId, {
						id: questionId,
						value,
						label,
						wasCustom,
						index,
						note: trimmedNote || undefined,
						answers: answerVector,
					});
				}

				function clearEditorMode() {
					inputMode = null;
					inputQuestionId = null;
					noteOption = null;
					editor.setText("");
				}

				// Editor submit callback
				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;

					if (inputMode === "note" && noteOption) {
						saveAnswer(inputQuestionId, noteOption.value, noteOption.label, false, noteOption.index, value);
						clearEditorMode();
						advanceAfterAnswer();
						return;
					}

					const trimmed = value.trim() || "(no response)";
					saveAnswer(inputQuestionId, trimmed, trimmed, true);
					clearEditorMode();
					advanceAfterAnswer();
				};

				function handleInput(data: string) {
					// Editor modes: route text input to editor, with Codex-style note cancellation.
					if (inputMode) {
						if (matchesKey(data, Key.escape) || (inputMode === "note" && matchesKey(data, Key.tab))) {
							clearEditorMode();
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const q = currentQuestion();
					const opts = currentOptions();

					// Question navigation (multi-question only). Tab is reserved for option notes.
					if (isMulti) {
						if (matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							optionIndex = 0;
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							optionIndex = 0;
							refresh();
							return;
						}
					}

					// Submit tab
					if (currentTab === questions.length) {
						if (matchesKey(data, Key.enter) && allAnswered()) {
							submit(false);
						} else if (matchesKey(data, Key.escape)) {
							submit(true);
						}
						return;
					}

					// Option navigation
					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(opts.length - 1, optionIndex + 1);
						refresh();
						return;
					}

					// Attach a note to the highlighted option (Codex request_user_input behavior).
					if (matchesKey(data, Key.tab) && q) {
						const opt = opts[optionIndex];
						if (!opt) return;
						inputQuestionId = q.id;
						if (opt.isOther) {
							inputMode = "other";
							editor.setText("");
							refresh();
							return;
						}

						inputMode = "note";
						noteOption = { value: opt.value, label: opt.label, index: optionIndex + 1 };
						const existing = answers.get(q.id);
						editor.setText(existing?.value === opt.value ? existing.note || "" : "");
						refresh();
						return;
					}

					// Select option
					if (matchesKey(data, Key.enter) && q) {
						const opt = opts[optionIndex];
						if (!opt) return;
						if (opt.isOther) {
							inputMode = "other";
							inputQuestionId = q.id;
							editor.setText("");
							refresh();
							return;
						}
						saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
						advanceAfterAnswer();
						return;
					}

					// Cancel
					if (matchesKey(data, Key.escape)) {
						submit(true);
					}
				}

				function render(width: number): string[] {
					const renderWidth = Math.max(1, width);
					if (cachedLines && cachedWidth === renderWidth) return cachedLines;

					const lines: string[] = [];
					const q = currentQuestion();
					const opts = currentOptions();

					// Helper to wrap long lines instead of truncating them with ellipses.
					const add = (s: string) => lines.push(...wrapTextWithAnsi(s, renderWidth));

					add(theme.fg("accent", "─".repeat(renderWidth)));

					// Tab bar (multi-question only)
					if (isMulti) {
						const tabs: string[] = ["← "];
						for (let i = 0; i < questions.length; i++) {
							const isActive = i === currentTab;
							const isAnswered = answers.has(questions[i].id);
							const lbl = questions[i].label;
							const box = isAnswered ? "■" : "□";
							const color = isAnswered ? "success" : "muted";
							const text = ` ${box} ${lbl} `;
							const styled = isActive ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(color, text);
							tabs.push(`${styled} `);
						}
						const canSubmit = allAnswered();
						const isSubmitTab = currentTab === questions.length;
						const submitText = " ✓ Submit ";
						const submitStyled = isSubmitTab
							? theme.bg("selectedBg", theme.fg("text", submitText))
							: theme.fg(canSubmit ? "success" : "dim", submitText);
						tabs.push(`${submitStyled} →`);
						add(` ${tabs.join("")}`);
						lines.push("");
					}

					// Helper to render options list
					function renderOptions() {
						const answer = q ? answers.get(q.id) : undefined;
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const selected = i === optionIndex;
							const isOther = opt.isOther === true;
							const isAnsweredOption = answer?.value === opt.value && !answer.wasCustom;
							const isEditingThisNote = inputMode === "note" && noteOption?.value === opt.value;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const color = selected || isAnsweredOption ? "accent" : "text";
							const marker = isAnsweredOption ? "✓ " : `${i + 1}. `;

							if ((isOther && inputMode === "other") || isEditingThisNote) {
								add(prefix + theme.fg("accent", `${marker}${opt.label} ✎`));
							} else {
								add(prefix + theme.fg(color, `${marker}${opt.label}`));
							}
							if (opt.description) {
								add(`     ${theme.fg("muted", opt.description)}`);
							}
							if (isAnsweredOption && answer?.note) {
								add(`     ${theme.fg("muted", `user_note: ${answer.note}`)}`);
							}
						}
					}

					// Content
					if (inputMode && q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						// Show options for reference
						renderOptions();
						lines.push("");
						if (inputMode === "note" && noteOption) {
							add(theme.fg("muted", ` Note for: ${noteOption.label}`));
						} else {
							add(theme.fg("muted", " Your answer:"));
						}
						for (const line of editor.render(Math.max(1, renderWidth - 2))) {
							add(` ${line}`);
						}
						lines.push("");
						const help = inputMode === "note" ? " Enter to save note • Tab/Esc discard note" : " Enter to submit • Esc to cancel";
						add(theme.fg("dim", help));
					} else if (currentTab === questions.length) {
						add(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						for (const question of questions) {
							const answer = answers.get(question.id);
							if (answer) {
								const prefix = answer.wasCustom ? "(wrote) " : "";
								add(`${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", prefix + answer.label)}`);
								if (answer.note) {
									add(`${theme.fg("muted", "   user_note: ")}${theme.fg("text", answer.note)}`);
								}
							}
						}
						lines.push("");
						if (allAnswered()) {
							add(theme.fg("success", " Press Enter to submit"));
						} else {
							const missing = questions
								.filter((q) => !answers.has(q.id))
								.map((q) => q.label)
								.join(", ");
							add(theme.fg("warning", ` Unanswered: ${missing}`));
						}
					} else if (q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						renderOptions();
					}

					lines.push("");
					if (!inputMode) {
						const help = isMulti
							? " ←→ questions • ↑↓ select • Enter confirm • Tab add note • Esc cancel"
							: " ↑↓ navigate • Enter select • Tab add note • Esc cancel";
						add(theme.fg("dim", help));
					}
					add(theme.fg("accent", "─".repeat(renderWidth)));

					cachedLines = lines;
					cachedWidth = renderWidth;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					cachedWidth = undefined;
					},
					handleInput,
				};
				}),
			);

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled AskUserQuestion" }],
					details: result,
				};
			}

			const answerLines = result.answers.map((a) => {
				const qLabel = questions.find((q) => q.id === a.id)?.label || a.id;
				if (a.wasCustom) {
					return `${qLabel}: user wrote: ${a.label}`;
				}
				const selected = `${qLabel}: user selected: ${a.index}. ${a.label}`;
				return a.note ? `${selected}\n${qLabel}: user_note: ${a.note}` : selected;
			});

			return {
				content: [{ type: "text", text: answerLines.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const qs = (args.questions as RawQuestion[]) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.header || q.id).join(", ");
			let text = theme.fg("toolTitle", theme.bold("AskUserQuestion "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${labels})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((a) => {
				if (a.wasCustom) {
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${theme.fg("muted", "(wrote) ")}${a.label}`;
				}
				const display = a.index ? `${a.index}. ${a.label}` : a.label;
				const note = a.note ? `\n  ${theme.fg("muted", `user_note: ${a.note}`)}` : "";
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${display}${note}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
