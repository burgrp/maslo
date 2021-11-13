wg.pages.home = {
    async render(container, pageName) {

        let lastSledX, lastSledY;
        let trackToggle = false;

        let machineState;

        function svg(name) {
            return $(document.createElementNS('http://www.w3.org/2000/svg', name));
        }

        function updateRouterJob(job) {

            $(".page.home .controls .abchains .buttons").css("display", job.length ? "none" : "grid");
            $(".page.home .controls .job .buttons").css("display", job.length ? "grid" : "none");
            $(".page.home .controls .job").css("display", job.length ? "flex" : "none");

            let previewSvg = $("#previewSvg").empty();
            let pos = {
                    x: machineState.sled.position && machineState.sled.position.xMm,
                    y: machineState.sled.position && machineState.sled.position.yMm
            }
            
            for (let command of job) {
                if ((command.code === "G0" || command.code === "G1") && (isFinite(command.x) || isFinite(command.y))) {

                    let x = isFinite(command.x) && command.x || pos.x;
                    let y = isFinite(command.y) && command.y || pos.y;

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

        function updateMachineState(state) {

            machineState = state;

            let sledX = state.sled.position && state.sled.position.xMm;
            let sledY = state.sled.position && state.sled.position.yMm;

            $("button.standby").toggleClass("disabled", state.mode !== "STANDBY");

            $(".xyaxis .position .x").text(formatLength(sledX - state.userOrigin.xMm));
            $(".xyaxis .position .y").text(formatLength(sledY - state.userOrigin.yMm));
            $(".zaxis .position").text(formatLength(state.spindle.zMm));
            $(".zaxis .spindle").toggleClass("on", state.spindle.on);

            $(".scene svg").attr({
                viewBox: [
                    -machineState.beam.motorsDistanceMm / 2 - 100,
                    -machineState.beam.motorsToWorkspaceMm - machineState.workspace.heightMm - 100,
                    (machineState.beam.motorsDistanceMm + 200),
                    (machineState.beam.motorsToWorkspaceMm + machineState.workspace.heightMm + 200)
                ].join(' ')
            });

            let mX = state.beam.motorsDistanceMm / 2;
            let mY = state.workspace.heightMm + state.beam.motorsToWorkspaceMm;

            $(".scene .motor.a").attr({
                cx: -mX,
                cy: mY
            });

            $(".scene .motor.b").attr({
                cx: mX,
                cy: mY
            });

            $(".scene .workspace").attr({
                x: -state.workspace.widthMm / 2,
                y: 0,
                width: state.workspace.widthMm,
                height: state.workspace.heightMm
            });

            $(".scene .sled").attr({
                cx: sledX,
                cy: sledY,
            });

            $(".scene .sled.outline").attr({
                r: state.sled.diaMm / 2
            });

            $(".scene .userorigin.x").attr({
                x1: state.userOrigin.xMm - 30,
                y1: state.userOrigin.yMm,
                x2: state.userOrigin.xMm + 100,
                y2: state.userOrigin.yMm
            });

            $(".scene .userorigin.y").attr({
                x1: state.userOrigin.xMm,
                y1: state.userOrigin.yMm - 100,
                x2: state.userOrigin.xMm,
                y2: state.userOrigin.yMm + 30
            });

            $(".scene .chain, .scene .sled").attr({
                visibility: state.sled.position ? "visible" : "hidden"
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

            let dist = Math.sqrt(Math.pow(sledX - lastSledX, 2) + Math.pow(sledY - lastSledY, 2));
            if (dist > 10 || !isFinite(dist)) {

                if (isFinite(lastSledX) && isFinite(lastSledY) && isFinite(sledX) && isFinite(sledY)) {

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

            $(".scene").css({ visibility: "visible" });

            $(".state .text").text(JSON.stringify(state, null, 2));

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
                <line class="userorigin x" stroke="yellow" stroke-width="10"/>
                <line class="userorigin y" stroke="yellow" stroke-width="10"/>
                <g id="previewSvg"/>
                </g>
            </svg>                      
            `)]).css({ visibility: "hidden" }),
            DIV("controls", [
                DIV("group job", [
                    DIV("title").text("job"),
                    DIV("buttons", [
                        BUTTON("start standby").text("START").click(() => wg.common.check(async () => await wg.router.runJob())),
                        BUTTON("delete standby").text("DELETE").click(() => wg.common.check(async () => wg.router.deleteJob()))
                    ])
                ]),
                DIV("group abchains", [
                    DIV("title").text("chains"),
                    DIV("buttons", [
                        DIV("a side").text("A"),
                        wg.common.manualMoveButton("a up", "caret-up", "a", -1),
                        wg.common.manualMoveButton("a down", "caret-down", "a", 1),
                        DIV("b side").text("B"),
                        wg.common.manualMoveButton("b up", "caret-up", "b", -1),
                        wg.common.manualMoveButton("b down", "caret-down", "b", 1)
                    ])
                ]),
                DIV("group xyaxis", [
                    DIV("title").text("X,Y axis"),
                    DIV("buttons", [
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
                    DIV("title").text("Z axis"),
                    DIV("buttons", [
                        BUTTON("start control standby").text("START").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", true))),
                        BUTTON("stop control standby").text("STOP").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", false))),
                        DIV("spindle", [ICON("asterisk")]),
                        DIV("position dimension").text("-"),
                        wg.common.manualMoveButton("up", "caret-up", "z", 1),
                        wg.common.manualMoveButton("down", "caret-down", "z", -1)
                    ])
                ])
            ])
                .onMachineStateChanged(updateMachineState)
                .onRouterJobChanged(updateRouterJob)
        ]);

        $(".page.home .controls .group .title").click(ev => {
            let buttons = $(ev.target).parent().children(".buttons");
            if (buttons.css("display") === "none") {
                buttons.css("display", "grid");
            } else {
                buttons.css("display", "none");
            }
        });

        updateMachineState(await wg.machine.getState());
        updateRouterJob(await wg.router.getCode());
    }
}
