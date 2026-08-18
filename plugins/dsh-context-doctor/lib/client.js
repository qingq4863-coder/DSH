window.__ModuleLoader__.load({
	id: "dsh-context-doctor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/store.ts
		/**
		* Browser-side audit store: the audit report snapshot plus fetch lifecycle,
		* written only through the store's actions. Components only read snapshots.
		* @module dsh-context-doctor/client/store
		*/
		/** Create the audit store handle (apply world only; never module-level). */
		function createAuditStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					state: "idle",
					report: null,
					error: null,
					refreshedAt: null
				}),
				actions: {
					setState: (draft, state, error) => {
						draft.state = state;
						draft.error = error;
					},
					setReport: (draft, report) => {
						draft.report = report;
						draft.state = "ready";
						draft.error = null;
						draft.refreshedAt = Date.now();
					}
				}
			});
		}
		//#endregion
		//#region src/client/ContextAuditRing.tsx
		/**
		* Context Doctor's native composer control.
		* The panel deliberately uses one lightweight, mono-inspired visual language
		* in both DSH themes instead of inheriting the surrounding chat typography.
		*/
		const AUDIT_API = "/api/context-doctor/audit";
		const FULL_SCALE = 5e4;
		const TONE = {
			canvas: "var(--dsw-alias-bg-layer-2, #101722)",
			panel: "var(--dsw-alias-bg-layer-1, #171f2b)",
			row: "var(--dsw-alias-bg-layer-3, #1d2735)",
			border: "var(--dsw-alias-border-l2, rgba(196, 211, 232, 0.16))",
			borderStrong: "var(--dsw-alias-border-l3, rgba(196, 211, 232, 0.31))",
			text: "var(--dsw-alias-label-primary, #f2f6fc)",
			muted: "var(--dsw-alias-label-secondary, #9daabd)",
			quiet: "var(--dsw-alias-label-tertiary, #718096)",
			mint: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #78dda0) 76%, var(--dsw-alias-label-secondary, #9daabd))",
			amber: "var(--dsw-alias-state-warn-primary, #f6c652)",
			red: "var(--dsw-alias-state-error-primary, #ff8592)",
			blue: "var(--dsw-alias-brand-primary, #8ec5ff)"
		};
		const MONO = "ui-monospace, \"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace";
		function healthTone(tokens) {
			if (tokens < 1e4) return "mint";
			if (tokens < 3e4) return "amber";
			return "red";
		}
		function formatK(tokens) {
			if (tokens < 1e3) return String(tokens);
			const value = tokens / 1e3;
			return `${value >= 100 ? Math.round(value) : value.toFixed(1)}k`;
		}
		function updatedLabel(refreshedAt) {
			if (refreshedAt === null) return "—";
			const seconds = Math.max(0, Math.round((Date.now() - refreshedAt) / 1e3));
			if (seconds < 10) return "just now";
			if (seconds < 60) return `${seconds}s ago`;
			return `${Math.round(seconds / 60)}m ago`;
		}
		function PulseIcon({ size = 20 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3 12h4l2.05-5 3.62 10L15.2 12H21",
					stroke: "currentColor",
					strokeWidth: "1.8",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.6 6.8C5.1 4.86 8.06 4.4 10.06 6L12 7.58 13.94 6c2-1.6 4.96-1.14 6.46.8 1.72 2.23 1.43 5.42-.66 7.29L12 21l-7.74-6.91C2.17 12.22 1.88 9.03 3.6 6.8Z",
					stroke: "currentColor",
					strokeWidth: "1.45",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		function MetricIcon({ type }) {
			if (type === "skills") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4.5 5.5A3.5 3.5 0 0 1 8 4h3.5v15H8a3.5 3.5 0 0 0-3.5 1.5V5.5ZM19.5 5.5A3.5 3.5 0 0 0 16 4h-3.5v15H16a3.5 3.5 0 0 1 3.5 1.5V5.5Z",
					stroke: "currentColor",
					strokeWidth: "1.55",
					strokeLinejoin: "round"
				})
			});
			if (type === "tools") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m8.2 7-5 5 5 5M15.8 7l5 5-5 5M13.5 4l-3 16",
					stroke: "currentColor",
					strokeWidth: "1.65",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
			if (type === "mcp") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9 3v6m6-6v6M7 9h10v3a5 5 0 0 1-10 0V9Zm5 8v4m-3 0h6",
					stroke: "currentColor",
					strokeWidth: "1.65",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5 5h14M5 11h14M5 17h8M18 15.5v4M16 17.5h4",
					stroke: "currentColor",
					strokeWidth: "1.65",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function RefreshIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "21",
				height: "21",
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M20 11a8 8 0 0 0-14.98-3.8M4 5v4h4M4 13a8 8 0 0 0 14.98 3.8M20 19v-4h-4",
					stroke: "currentColor",
					strokeWidth: "1.8",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function CheckIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "21",
				height: "21",
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "9",
					stroke: "currentColor",
					strokeWidth: "1.7"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "m8.2 12.2 2.45 2.4 5.15-5.25",
					stroke: "currentColor",
					strokeWidth: "1.8",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			});
		}
		function BudgetRing({ percent, color }) {
			const radius = 43;
			const circumference = 2 * Math.PI * radius;
			const progress = Math.max(.035, Math.min(.965, percent));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "188",
				height: "188",
				viewBox: "0 0 112 112",
				"aria-hidden": "true",
				style: {
					display: "block",
					transform: "rotate(-90deg)"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "56",
					cy: "56",
					r: radius,
					fill: "none",
					stroke: TONE.borderStrong,
					strokeWidth: "5.7"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "56",
					cy: "56",
					r: radius,
					fill: "none",
					stroke: color,
					strokeWidth: "5.7",
					strokeLinecap: "round",
					strokeDasharray: `${progress * circumference} ${circumference}`
				})]
			});
		}
		/** Resident control that replaces the built-in meter just before Send. */
		function ContextAuditRing(props) {
			const { useStore, actions, sessionId } = props;
			const state = useStore((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const panelId = (0, react.useId)();
			const controllerRef = (0, react.useRef)(null);
			const refresh = (0, react.useCallback)(() => {
				controllerRef.current?.abort();
				const controller = new AbortController();
				controllerRef.current = controller;
				actions.setState("loading", null);
				fetch(`${AUDIT_API}?session=${encodeURIComponent(sessionId)}`, { signal: controller.signal }).then((response) => {
					if (!response.ok) throw new Error(`audit ${response.status}`);
					return response.json();
				}).then((data) => {
					if (controller.signal.aborted) return;
					if (data.ok && data.report !== null && data.report !== void 0) actions.setReport(data.report);
					else actions.setState("error", "empty audit response");
				}, () => {
					if (!controller.signal.aborted) actions.setState("error", "audit transport error");
				});
			}, [actions, sessionId]);
			(0, react.useEffect)(() => {
				refresh();
				return () => controllerRef.current?.abort();
			}, [refresh]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open]);
			const report = state.report;
			const instructions = report?.injected.instructions.totalTokens ?? 0;
			const skills = report?.injected.skills.catalogDescriptionTokens ?? 0;
			const schemas = report?.injected.tools.schemaTokens ?? 0;
			const resident = instructions + skills + schemas;
			const percent = resident / FULL_SCALE;
			const accent = TONE[state.state === "error" ? "red" : healthTone(resident)];
			const suggestions = report?.suggestions ?? [];
			const status = state.state === "error" ? "Audit failed" : suggestions.length ? "Review" : "Healthy";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				"data-context-doctor": true,
				style: dockStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setOpen((value) => !value),
					title: "Context Doctor",
					"aria-label": "Context Doctor",
					"aria-expanded": open,
					"aria-controls": panelId,
					style: triggerStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								color: accent,
								display: "inline-flex"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PulseIcon, { size: 17 })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: triggerLabelStyle,
							children: "Context Doctor"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							style: {
								...triggerStatusStyle,
								background: accent
							}
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					id: panelId,
					role: "dialog",
					"aria-label": "Context Doctor",
					style: panelStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							style: headerStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									color: TONE.mint,
									display: "inline-flex"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PulseIcon, { size: 31 })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								style: titleStyle,
								children: "Context Doctor"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: subtitleStyle,
								children: "Context budget audit"
							})] })]
						}),
						state.state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: errorStyle,
							children: ["Audit failed: ", state.error]
						}),
						report === null && state.state !== "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: emptyStyle,
							children: state.state === "loading" ? "Auditing context…" : "No audit data yet."
						}) : report !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: summaryStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: gaugeColumnStyle,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: gaugeWrapStyle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BudgetRing, {
												percent,
												color: accent
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: gaugeCaptionStyle,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
													style: {
														color: accent,
														fontSize: 37,
														fontWeight: 460
													},
													children: [Math.round(Math.min(percent, 1) * 100), "%"]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: gaugeGuideStyle,
													children: "of 50k"
												})]
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: totalLabelStyle,
											children: "Total"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: totalStyle,
											children: formatK(resident)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: tokensStyle,
											children: "tokens"
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: metricsStyle,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetricRow, {
											type: "instructions",
											label: "Instruction chain",
											value: instructions,
											ratio: resident === 0 ? 0 : instructions / resident,
											color: TONE.mint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetricRow, {
											type: "skills",
											label: "Skills catalog",
											value: skills,
											ratio: resident === 0 ? 0 : skills / resident,
											color: TONE.mint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetricRow, {
											type: "tools",
											label: "Tool schemas",
											value: schemas,
											ratio: resident === 0 ? 0 : schemas / resident,
											color: TONE.amber
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetricRow, {
											type: "mcp",
											label: "MCP tools",
											value: report.injected.tools.mcp.totalTokens,
											ratio: resident === 0 ? 0 : report.injected.tools.mcp.totalTokens / resident,
											color: TONE.mint
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: healthStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: accent,
										display: "inline-flex"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: {
										...healthTitleStyle,
										color: accent
									},
									children: status
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: healthCopyStyle,
									children: suggestions.length ? "Some context entries are worth reviewing before they become expensive." : "Your context is efficient and remains within the recommended budget."
								})] })]
							}),
							suggestions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: suggestionsStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: suggestionsTitleStyle,
									children: "Suggestions"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									style: suggestionListStyle,
									children: suggestions.slice(0, 3).map((suggestion, index) => {
										const tone = suggestion.severity === "high" ? TONE.red : suggestion.severity === "medium" ? TONE.amber : TONE.mint;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											style: suggestionStyle,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														...suggestionIndexStyle,
														color: tone,
														borderColor: tone
													},
													children: index + 1
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: suggestionCopyStyle,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														style: {
															color: tone,
															fontWeight: 520
														},
														children: "Review audit finding"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: suggestion.text })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"aria-hidden": "true",
													style: arrowStyle,
													children: "›"
												})
											]
										}, `${suggestion.severity}-${suggestion.text}`);
									})
								})]
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							style: footerStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: updatedStyle,
								children: ["Last updated: ", updatedLabel(state.refreshedAt)]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: refresh,
								disabled: state.state === "loading",
								style: refreshStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {}), "Refresh"]
							})]
						})
					]
				})]
			});
		}
		function MetricRow({ type, label, value, ratio, color }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: metricRowStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							...metricIconStyle,
							color
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetricIcon, { type })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: metricLabelStyle,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: metricValueStyle,
						children: formatK(value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							...metricPercentStyle,
							color
						},
						children: [Math.round(ratio * 100), "%"]
					})
				]
			});
		}
		const dockStyle = {
			display: "inline-flex",
			alignItems: "center",
			position: "relative",
			fontFamily: MONO
		};
		const triggerStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 7,
			minHeight: 33,
			padding: "5px 10px",
			color: TONE.text,
			background: TONE.panel,
			border: `1px solid ${TONE.border}`,
			borderRadius: 7,
			cursor: "pointer",
			fontFamily: MONO,
			fontWeight: 430
		};
		const triggerLabelStyle = {
			color: TONE.text,
			fontSize: 12,
			fontWeight: 430,
			whiteSpace: "nowrap"
		};
		const triggerStatusStyle = {
			width: 8,
			height: 8,
			marginLeft: 2,
			borderRadius: 99,
			boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 8%, transparent)"
		};
		const panelStyle = {
			position: "absolute",
			zIndex: 1e3,
			right: 0,
			bottom: "calc(100% + 14px)",
			width: 560,
			maxWidth: "calc(100vw - 24px)",
			maxHeight: "calc(100vh - 101px)",
			overflowX: "hidden",
			overflowY: "auto",
			color: TONE.text,
			background: TONE.canvas,
			border: `1px solid ${TONE.borderStrong}`,
			borderRadius: 15,
			boxShadow: "0 24px 62px rgba(3, 8, 18, 0.38)",
			textAlign: "left",
			fontFamily: MONO,
			fontWeight: 400
		};
		const headerStyle = {
			display: "grid",
			gridTemplateColumns: "34px 1fr",
			alignItems: "center",
			columnGap: 14,
			padding: "24px 28px 22px",
			borderBottom: `1px solid ${TONE.border}`
		};
		const titleStyle = {
			margin: 0,
			color: TONE.text,
			fontFamily: MONO,
			fontSize: 23,
			fontWeight: 460,
			letterSpacing: "-0.025em",
			lineHeight: 1.1
		};
		const subtitleStyle = {
			margin: "10px 0 0",
			color: TONE.muted,
			fontFamily: MONO,
			fontSize: 14,
			fontWeight: 400,
			lineHeight: 1.2
		};
		const errorStyle = {
			margin: "14px 28px 0",
			color: TONE.red,
			fontSize: 13,
			lineHeight: 1.45
		};
		const emptyStyle = {
			padding: "50px 28px",
			color: TONE.muted,
			fontSize: 14,
			textAlign: "center"
		};
		const summaryStyle = {
			display: "grid",
			gridTemplateColumns: "42% 58%",
			minHeight: 305,
			borderBottom: `1px solid ${TONE.border}`
		};
		const gaugeColumnStyle = {
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			padding: "25px 18px",
			borderRight: `1px solid ${TONE.border}`
		};
		const gaugeWrapStyle = {
			position: "relative",
			width: 188,
			height: 188,
			display: "grid",
			placeItems: "center"
		};
		const gaugeCaptionStyle = {
			position: "absolute",
			inset: 0,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 7
		};
		const gaugeGuideStyle = {
			color: TONE.muted,
			fontSize: 13,
			fontWeight: 400
		};
		const totalLabelStyle = {
			marginTop: 21,
			color: TONE.muted,
			fontSize: 15,
			fontWeight: 400
		};
		const totalStyle = {
			marginTop: 8,
			color: TONE.text,
			fontSize: 34,
			fontWeight: 440,
			lineHeight: 1,
			letterSpacing: "-0.045em",
			fontVariantNumeric: "tabular-nums"
		};
		const tokensStyle = {
			marginTop: 9,
			color: TONE.muted,
			fontSize: 15,
			fontWeight: 400
		};
		const metricsStyle = {
			display: "flex",
			flexDirection: "column",
			justifyContent: "center",
			gap: 17,
			padding: "26px 30px"
		};
		const metricRowStyle = {
			display: "grid",
			gridTemplateColumns: "43px minmax(0, 1fr) auto 39px",
			alignItems: "center",
			columnGap: 10,
			minHeight: 55
		};
		const metricIconStyle = {
			display: "grid",
			width: 41,
			height: 41,
			placeItems: "center",
			border: `1px solid ${TONE.border}`,
			borderRadius: 8
		};
		const metricLabelStyle = {
			overflow: "hidden",
			color: TONE.text,
			fontSize: 15,
			fontWeight: 420,
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const metricValueStyle = {
			color: TONE.text,
			fontSize: 15,
			fontWeight: 420,
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};
		const metricPercentStyle = {
			textAlign: "right",
			fontSize: 15,
			fontWeight: 430,
			fontVariantNumeric: "tabular-nums"
		};
		const healthStyle = {
			display: "grid",
			gridTemplateColumns: "42px 1fr",
			alignItems: "start",
			columnGap: 12,
			padding: "23px 29px 25px",
			borderBottom: `1px solid ${TONE.border}`
		};
		const healthTitleStyle = {
			display: "block",
			marginTop: 1,
			fontSize: 17,
			fontWeight: 470
		};
		const healthCopyStyle = {
			margin: "8px 0 0",
			color: TONE.muted,
			fontSize: 14,
			fontWeight: 400,
			lineHeight: 1.5
		};
		const suggestionsStyle = {
			padding: "23px 29px 22px",
			borderBottom: `1px solid ${TONE.border}`
		};
		const suggestionsTitleStyle = {
			margin: "0 0 15px",
			color: TONE.text,
			fontSize: 16,
			fontWeight: 440
		};
		const suggestionListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			margin: 0,
			padding: 0,
			listStyle: "none"
		};
		const suggestionStyle = {
			display: "grid",
			gridTemplateColumns: "33px minmax(0, 1fr) 15px",
			alignItems: "center",
			columnGap: 12,
			padding: "11px 13px",
			background: TONE.row,
			border: `1px solid ${TONE.border}`,
			borderRadius: 9
		};
		const suggestionIndexStyle = {
			display: "grid",
			width: 29,
			height: 29,
			placeItems: "center",
			border: "1px solid",
			borderRadius: 99,
			fontSize: 14,
			fontWeight: 460
		};
		const suggestionCopyStyle = {
			display: "flex",
			flexDirection: "column",
			minWidth: 0,
			gap: 4,
			fontSize: 14,
			lineHeight: 1.35
		};
		const arrowStyle = {
			color: TONE.text,
			fontSize: 28,
			fontWeight: 300,
			lineHeight: 1
		};
		const footerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			padding: "19px 29px 20px"
		};
		const updatedStyle = {
			color: TONE.quiet,
			fontSize: 13,
			fontWeight: 400,
			fontVariantNumeric: "tabular-nums"
		};
		const refreshStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 9,
			padding: 0,
			color: TONE.blue,
			background: "transparent",
			border: 0,
			cursor: "pointer",
			fontFamily: MONO,
			fontSize: 15,
			fontWeight: 430
		};
		//#endregion
		//#region src/client/locales.ts
		/**
		* Context Doctor locale dictionaries.
		* The audit panel intentionally renders its compact product vocabulary in
		* English so it remains stable alongside a localized DSH shell.
		*/
		const NS = "context-doctor";
		const copy = {
			"cd.title": "Context Doctor",
			"cd.residentTokens": "Context budget audit",
			"cd.instructions": "Instruction chain",
			"cd.skills": "Skills catalog",
			"cd.tools": "Tool schemas",
			"cd.mcp": "MCP tools",
			"cd.suggestions": "{n} suggestions",
			"cd.refresh": "Refresh",
			"cd.loading": "Auditing…",
			"cd.error": "Audit failed",
			"cd.empty": "No data yet",
			"cd.healthy": "Healthy",
			"cd.attention": "Review",
			"cd.review": "Review",
			"cd.healthyHint": "Your context is efficient and remains within the recommended budget.",
			"cd.reviewHint": "Some context entries are worth reviewing before they become expensive.",
			"cd.guideline": "of 50k",
			"cd.updated": "Last updated",
			"cd.catalog": "{n} skills",
			"cd.mcpTools": "{n} tools",
			"cd.files": "files",
			"cd.toolsCount": "tools",
			"cd.hint": "Open Context Doctor"
		};
		const zh = copy;
		const en = copy;
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: register dictionaries, seed the store, and seat the
		* audit control once its native replacement hole is on the ledger.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "context-doctor: dictionaries");
			const store = createAuditStore();
			ctx.slots.inject("conversation.input.context", () => ctx.slots.register({
				name: "conversation.input.context",
				store,
				locale: NS
			}, ContextAuditRing));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map