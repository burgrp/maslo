wg.pages.home = {
    title: "Home",

    async render(container, pageName) {

        let lastSledX, lastSledY;
        let trackToggle = false;

        let state = await wg.machine.getState();
        let config = await wg.config.get();
        let job = await wg.router.getCode();

        function svg(name) {
            return $(document.createElementNS('http://www.w3.org/2000/svg', name));
        }

        function updateScene() {

            let sledX = state.sled.xMm;
            let sledY = state.sled.yMm;

            $("button.standby").toggleClass("disabled", state.mode !== "STANDBY");

            $(".xyaxis .position .x").text(formatLength(sledX - config.userOrigin.xMm));
            $(".xyaxis .position .y").text(formatLength(sledY - config.userOrigin.yMm));
            $(".zaxis .position").text(formatLength(state.spindle.zMm));
            $(".zaxis .position")
                .toggleClass("moving", state.motors.z.state && Math.abs(state.motors.z.state.duty) > 0.1)
                .toggleClass("out", state.spindle.zMm < 0);
            $(".zaxis .spindle").toggleClass("on", state.relays.spindle.state && state.relays.spindle.state.on);

            $(".scene svg").attr({
                viewBox: [
                    -config.beam.motorsDistanceMm / 2 - 100,
                    -config.beam.motorsToWorkspaceMm - config.workspace.heightMm / 2 - 100,
                    (config.beam.motorsDistanceMm + 200),
                    (config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 + 200)
                ].join(' ')
            });

            let mX = config.beam.motorsDistanceMm / 2;
            let mY = config.workspace.heightMm / 2 + config.beam.motorsToWorkspaceMm;

            $(".scene .motor.a").attr({
                cx: -mX,
                cy: mY
            });

            $(".scene .motor.b").attr({
                cx: mX,
                cy: mY
            });

            $(".scene .workspace").attr({
                x: -config.workspace.widthMm / 2,
                y: -config.workspace.heightMm / 2,
                width: config.workspace.widthMm,
                height: config.workspace.heightMm
            });

            $(".scene .sled").attr({
                cx: sledX,
                cy: sledY,
            });

            $(".scene .sled.outline").attr({
                r: config.sled.diaMm / 2
            });

            $(".scene .userorigin.x").attr({
                x1: config.userOrigin.xMm - 30,
                y1: config.userOrigin.yMm,
                x2: config.userOrigin.xMm + 100,
                y2: config.userOrigin.yMm
            });

            $(".scene .userorigin.y").attr({
                x1: config.userOrigin.xMm,
                y1: config.userOrigin.yMm + 100,
                x2: config.userOrigin.xMm,
                y2: config.userOrigin.yMm - 30
            });

            $(".scene .chain, .scene .sled").attr({
                visibility: (Number.isFinite(state.sled.xMm) && Number.isFinite(state.sled.yMm)) ? "visible" : "hidden"
            });

            $(".scene .chain.a").attr({
                x1: sledX,
                y1: sledY,
                x2: -mX,
                y2: mY
            });

            $(".scene .chain.b").attr({
                x1: sledX,
                y1: sledY,
                x2: mX,
                y2: mY
            });

            for (let motor of [{ name: "a", "side": -1 }, { name: "b", "side": 1 }]) {
                $(`.scene .duty-bar.${motor.name}`).attr({
                    x1: motor.side * config.beam.motorsDistanceMm / 2,
                    y1: 0,
                    x2: motor.side * config.beam.motorsDistanceMm / 2,
                    y2: config.workspace.heightMm / 2 * (state.motors[motor.name].duty || 0)
                });
                $(`.scene .error-bar.${motor.name}`).attr({
                    x1: motor.side * (config.beam.motorsDistanceMm / 2 - 100),
                    y1: 0,
                    x2: motor.side * (config.beam.motorsDistanceMm / 2 - 100),
                    y2: config.workspace.heightMm / 2 * (state.motors[motor.name].offset || 0)
                });
            }

            let dist = Math.sqrt(Math.pow(sledX - lastSledX, 2) + Math.pow(sledY - lastSledY, 2));
            if (dist > 10 || !Number.isFinite(dist)) {

                if (Number.isFinite(lastSledX) && Number.isFinite(lastSledY) && Number.isFinite(sledX) && Number.isFinite(sledY)) {

                    svg("line").attr({
                        x1: lastSledX,
                        y1: lastSledY,
                        x2: sledX,
                        y2: sledY,
                        stroke: trackToggle ? "red" : "white",
                        "stroke-width": "10"
                    }).appendTo(".scene svg g.ucs");

                    trackToggle = !trackToggle;
                }

                lastSledX = sledX;
                lastSledY = sledY;
            }

            $(".scene .target.x").attr({
                x1: state.target && state.target.xMm - 50,
                y1: state.target && state.target.yMm - 50,
                x2: state.target && state.target.xMm + 50,
                y2: state.target && state.target.yMm + 50,
                visibility: state.target ? "visible" : "hidden"
            });

            $(".scene .target.y").attr({
                x1: state.target && state.target.xMm - 50,
                y1: state.target && state.target.yMm + 50,
                x2: state.target && state.target.xMm + 50,
                y2: state.target && state.target.yMm - 50,
                visibility: state.target ? "visible" : "hidden"
            });

            $(".scene").css({ visibility: "visible" });

            $(".state .text").text(JSON.stringify(state, null, 2));

        }

        function updateRouterJob() {

            updateScene();

            $(".page.home .controls .abchains .collapsable").css("display", job.length ? "none" : "grid");
            $(".page.home .controls .job .collapsable").css("display", job.length ? "grid" : "none");
            $(".page.home .controls .job").css("display", job.length ? "flex" : "none");

            let previewSvg = $("#previewSvg").empty();
            let pos = {
                x: state.sled.xMm,
                y: state.sled.yMm
            }

            for (let command of job) {
                if ((command.code === "G0" || command.code === "G1") && (Number.isFinite(command.x) || Number.isFinite(command.y))) {

                    let x = Number.isFinite(command.x) && command.x || pos.x;
                    let y = Number.isFinite(command.y) && command.y || pos.y;

                    if (pos) {
                        previewSvg.append(svg("line").attr({
                            x1: pos.x,
                            y1: pos.y,
                            x2: x,
                            y2: y,
                            stroke: command.code === "G0" ? "gray" : "silver",
                            "stroke-width": 5
                        }));
                    }
                    pos = { x, y };
                }
            }
        }

        wg.common.page(container, pageName, [
            DIV("state", [
                DIV("text")
            ]),
            DIV("scene", [$(`
            <svg preserveAspectRatio="xMinYMin" width="100%" xmlns="http://www.w3.org/2000/svg">
                <g class="ucs">
                <circle class="motor a" r="50" fill="red"/>
                <circle class="motor b" r="50" fill="red"/>
                <rect class="workspace" fill="none" stroke="silver" stroke-width="10"/>
                <circle class="sled center" r="50" fill="red"/>
                <circle class="sled outline" fill="none" stroke="gray" stroke-width="20"/>
                <line class="chain a" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="chain b" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="target x" stroke="white" stroke-width="10"/>
                <line class="target y" stroke="white" stroke-width="10"/>
                <line class="userorigin x" stroke="yellow" stroke-width="10"/>
                <line class="userorigin y" stroke="yellow" stroke-width="10"/>
                <line class="duty-bar a" stroke="yellow" stroke-width="50"/>
                <line class="duty-bar b" stroke="yellow" stroke-width="50"/>
                <line class="error-bar a" stroke="red" stroke-width="50"/>
                <line class="error-bar b" stroke="red" stroke-width="50"/>
                <g id="previewSvg"/>
                </g>
            </svg>                      
            `),
            ]).css({ visibility: "hidden" }),
            DIV("controls", [
                DIV("group job", [
                    DIV("group-title").text("job"),
                    DIV("group-content", [
                        BUTTON("start control standby").text("START").click(() => wg.common.check(async () => await wg.router.runJob())),
                        BUTTON("delete control standby").text("DELETE").click(() => wg.common.check(async () => wg.router.deleteJob()))
                    ])
                ]),
                DIV("group abchains", [
                    DIV("group-title").text("chains"),
                    DIV("group-content", [
                        DIV("a side").text("A"),
                        wg.common.manualMoveButton("a up", "caret-up", "a", -1),
                        wg.common.manualMoveButton("a down", "caret-down", "a", 1),
                        DIV("ab side").text("A+B"),
                        wg.common.manualMoveButton("ab up", "caret-up", "ab", -1),
                        wg.common.manualMoveButton("ab down", "caret-down", "ab", 1),
                        DIV("b side").text("B"),
                        wg.common.manualMoveButton("b up", "caret-up", "b", -1),
                        wg.common.manualMoveButton("b down", "caret-down", "b", 1)
                    ])
                ]),
                DIV("group calibration", [
                    DIV("group-title").text("calibration"),
                    DIV("group-content", [
                        NUMBER("value"),
                        DIV("unit").text("mm"),
                        ...["top", "bottom", "tool"]
                            .map(kind =>
                                BUTTON(kind).text(kind).click(() => {
                                    wg.common.check(async () => {
                                        let input = $(".calibration .group-content input");
                                        await wg.machine.setCalibration(kind, parseFloat(input.val()));
                                        input.val("");
                                    });
                                })
                            )
                    ])
                ]),
                DIV("group xyaxis", [
                    DIV("group-title").text("X,Y axis"),
                    DIV("group-content", [
                        wg.common.manualMoveButton("dir0", "caret-up", "xy", 0, 1),
                        wg.common.manualMoveButton("dir45", "caret-up", "xy", 1, 1),
                        wg.common.manualMoveButton("dir90", "caret-up", "xy", 1, 0),
                        wg.common.manualMoveButton("dir135", "caret-up", "xy", 1, -1),
                        wg.common.manualMoveButton("dir180", "caret-up", "xy", 0, -1),
                        wg.common.manualMoveButton("dir225", "caret-up", "xy", -1, -1),
                        wg.common.manualMoveButton("dir270", "caret-up", "xy", -1, 0),
                        wg.common.manualMoveButton("dir315", "caret-up", "xy", -1, 1),
                        BUTTON("position control", [
                            DIV("x").text("-"),
                            DIV("y").text("-"),
                            DIV("dimension")
                        ]).click(() => wg.common.check(async () => await wg.machine.resetUserOrigin()))
                    ])
                ]),
                DIV("group zaxis", [
                    DIV("group-title").text("Z axis"),
                    DIV("group-content", [
                        BUTTON("start control standby").text("START").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", true))),
                        BUTTON("stop control standby").text("STOP").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", false))),
                        DIV("spindle", [ICON("asterisk")]),
                        DIV("position dimension").text("-"),
                        wg.common.manualMoveButton("up", "caret-up", "z", 1),
                        wg.common.manualMoveButton("down", "caret-down", "z", -1)
                    ])
                ])
            ])
                .onMachineModelChanged(s => {
                    state = s;
                    updateScene();
                })
                .onConfigModelChanged(c => {
                    config = c;
                    updateScene();
                })
                .onRouterModelChanged(j => {
                    job = j;
                    updateRouterJob();
                })
        ]);

        let calibrated = Number.isFinite(state.sled.xMm) && Number.isFinite(state.sled.yMm) && Number.isFinite(state.spindle.zMm);
        $(".page.home .controls .abchains .group-content").toggleClass("hidden", calibrated);
        $(".page.home .controls .calibration .group-content").toggleClass("hidden", calibrated);
        $(".page.home .controls .xyaxis .group-content").toggleClass("hidden", !calibrated);

        $(".page.home .controls .group-title").click(ev => {
            let content = $(ev.target).parent().children(".group-content");
            content.toggleClass("hidden");
        });

        updateRouterJob();

        let dropFrame = $(".page.home .scene");
        $(".page.home .state, .page.home .scene, .page.home .scene *")
            .on("dragover", ev => {
                dropFrame.toggleClass("drop", true);
                ev.preventDefault();
                ev.stopPropagation();
            })
            .on("dragleave", ev => {
                dropFrame.toggleClass("drop", false);
                ev.preventDefault();
                ev.stopPropagation();
            })
            .on("drop", ev => {
                dropFrame.toggleClass("drop", false);
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.originalEvent.dataTransfer.files.length) {
                    wg.common.check(async () => {
                        let data = await ev.originalEvent.dataTransfer.files[0].arrayBuffer();
                        await wg.pages.home.importFile(data);
                        console.info("Done");
                    });
                }
            });

    },

    importFile(data) {
        return new Promise((resolve, reject) => {
            $.ajax("/job", {
                method: "post",
                data: new Uint8Array(data),
                contentType: "application/octet-stream",
                processData: false,
                success: resolve,
                error: error => {
                        reject(error.responseJSON && error.responseJSON.message || error.responseText || error.message || error);
                }
            });
        }
        );
    }

}

