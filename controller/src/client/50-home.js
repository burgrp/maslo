function ICON(glyph) {
    return $(`<i class="icon fas fa-${glyph}"/>`);
}

wg.common = {
    page(container, name, content) {

        let link = (linkName, path, icon) => AHREF(linkName + (linkName === name ? " active" : ""), { href: path }, [ICON(icon)]);

        container.append(DIV("page " + name, [
            DIV("navigation", [
                link("home", "/", "home"),
                link("jobs", "jobs", "folder-open"),
                link("calibration", "calibration", "ruler-combined"),
                link("settings", "settings", "tools"),
                DIV("end", [
                    BUTTON("stop", [
                        ICON("exclamation-triangle"),
                        DIV().text("STOP")
                    ]).click(() => wg.common.check(async () => await wg.machine.emergencyStop()))
                ])
            ]),
            DIV("content", content),
            DIV("errors")
        ]));
    },

    showError(error) {
        console.error("Error:", error);
        $(".page .errors").append(DIV().text(error.message || error).click(e => $(e.target).fadeOut(() => $(e.target).remove())));
    },

    async check(asyncAction) {
        try {
            await asyncAction();
        } catch (error) {
            wg.common.showError(error);
        }
    }
}

wg.pages.home = {
    async render(container, pageName) {

        let lastSledX, lastSledY;
        let trackToggle = false;

        let machineState;

        function svg(name) {
            return $(document.createElementNS('http://www.w3.org/2000/svg', name));
        }

        function updateRouterJob(job) {
            let previewSvg = $("#previewSvg").empty();
            let pos;
            for (let command of job) {
                if ((command.code === "G0" || command.code === "G1") && (isFinite(command.x) || isFinite(command.y))) {

                    let x = isFinite(command.x) ?
                        command.x - machineState.workspace.widthMm / 2
                        : pos.x;

                    let y = isFinite(command.y) ?
                        (machineState.workspace.heightMm + machineState.motorsToWorkspaceVerticalMm) - command.y
                        : pos.y;

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

            let sledX = state.sledPosition && state.sledPosition.xMm;
            let sledY = state.sledPosition && state.sledPosition.yMm;

            $(".xyaxis .position .x").text(sledX === undefined ? "?" : Math.round((sledX - state.userOrigin.xMm) * 10) / 10);
            $(".xyaxis .position .y").text(sledY === undefined ? "?" : -Math.round((sledY - state.userOrigin.yMm) * 10) / 10);
            $(".zaxis .position").text(Math.round(state.spindle.zMm * 10)/10);
            $(".zaxis .spindle").toggleClass("on", state.spindle.on);

            $(".scene svg").attr({ viewBox: `-${state.motorsShaftDistanceMm / 2 + 100} -100 ${state.motorsShaftDistanceMm + 200} 1` });

            $(".scene .motor.a").attr({
                cx: -state.motorsShaftDistanceMm / 2
            });

            $(".scene .motor.b").attr({
                cx: state.motorsShaftDistanceMm / 2
            });

            $(".scene .workspace").attr({
                x: -state.workspace.widthMm / 2,
                y: state.motorsToWorkspaceVerticalMm,
                width: state.workspace.widthMm,
                height: state.workspace.heightMm
            });

            $(".scene .sled").attr({
                cx: sledX,
                cy: sledY,
            });

            $(".scene .sled.outline").attr({
                r: state.sledDiameterMm / 2
            });


            $(".scene .follow").attr({
                cx: state.followPosition && state.followPosition.xMm,
                cy: state.followPosition && state.followPosition.yMm,
                visibility: state.followPosition ? "visible" : "hidden"
            });

            $(".scene .target.x").attr({
                x1: state.targetPosition && state.targetPosition.xMm - 50,
                y1: state.targetPosition && state.targetPosition.yMm - 50,
                x2: state.targetPosition && state.targetPosition.xMm + 50,
                y2: state.targetPosition && state.targetPosition.yMm + 50,
                visibility: state.targetPosition ? "visible" : "hidden"
            });

            $(".scene .target.y").attr({
                x1: state.targetPosition && state.targetPosition.xMm - 50,
                y1: state.targetPosition && state.targetPosition.yMm + 50,
                x2: state.targetPosition && state.targetPosition.xMm + 50,
                y2: state.targetPosition && state.targetPosition.yMm - 50,
                visibility: state.targetPosition ? "visible" : "hidden"
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
                visibility: state.sledPosition ? "visible" : "hidden"
            });

            $(".scene .chain.a").attr({
                x1: sledX,
                y1: sledY,
                x2: -state.motorsShaftDistanceMm / 2,
                y2: 0
            });

            $(".scene .chain.b").attr({
                x1: sledX,
                y1: sledY,
                x2: state.motorsShaftDistanceMm / 2,
                y2: 0
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
                    }).appendTo(".scene svg");

                    trackToggle = !trackToggle;
                }

                lastSledX = sledX;
                lastSledY = sledY;
            }

            $(".scene").css({ visibility: "visible" });

            $(".state").text(JSON.stringify(state, null, 2));

        }


        function manualMoveButton(clazz, icon, kind, ...direction) {
            let button = BUTTON(clazz, [ICON(icon)]);
            let isDown = false;

            function down() {
                if (!isDown) {
                    isDown = true;
                    console.info("motor start", kind, ...direction);
                    wg.common.check(async () => await wg.machine.manualMoveStart(kind, ...direction));
                }
            }

            function up() {
                if (isDown) {
                    isDown = false;
                    console.info("motor stop", kind);
                    wg.common.check(async () => await wg.machine.manualMoveStop(kind));
                }
            }

            button.mousedown(down);
            button.keydown(e => {
                if (e.key === " ") {
                    down();
                }
            });
            button.mouseleave(up);
            button.click(up);
            button.contextmenu(e => {
                e.preventDefault();
            });

            button.on("touchstart", down);
            button.on("touchend", up);

            return button;
        }

        wg.common.page(container, pageName, [
            DIV("scene", [$(`
            <svg preserveAspectRatio="xMinYMin" width="100%" xmlns="http://www.w3.org/2000/svg">
                <circle class="motor a" cy="0" r="50" fill="red"/>
                <circle class="motor b" cy="0" r="50" fill="red"/>
                <rect class="workspace" fill="none" stroke="silver" stroke-width="10"/>
                <circle class="sled center" r="50" fill="red"/>
                <circle class="sled outline" fill="none" stroke="gray" stroke-width="20"/>
                <line class="chain a" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="chain b" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="userorigin x" stroke="yellow" stroke-width="10"/>
                <line class="userorigin y" stroke="yellow" stroke-width="10"/>
                <line class="target x" stroke="white" stroke-width="10"/>
                <line class="target y" stroke="white" stroke-width="10"/>
                <circle class="follow" r="60" fill="none" stroke="white" stroke-width="10"/>
                <g id="previewSvg"/>
            </svg>                      
            `)]).css({ visibility: "hidden" }),
            DIV("state"),
            DIV("controls", [
                DIV("group abchains", [
                    DIV("title").text("chains"),
                    DIV("buttons", [
                        DIV("a side").text("A"),
                        manualMoveButton("a up", "caret-up", "a", -1),
                        manualMoveButton("a down", "caret-down", "a", 1),
                        DIV("b side").text("B"),
                        manualMoveButton("b up", "caret-up", "b", -1),
                        manualMoveButton("b down", "caret-down", "b", 1)
                    ])
                ]),
                DIV("group xyaxis", [
                    DIV("title").text("X,Y axis"),
                    DIV("buttons", [
                        manualMoveButton("dir0", "caret-up", "xy", 0, 1),
                        manualMoveButton("dir45", "caret-up", "xy", 1, 1),
                        manualMoveButton("dir90", "caret-up", "xy", 1, 0),
                        manualMoveButton("dir135", "caret-up", "xy", 1, -1),
                        manualMoveButton("dir180", "caret-up", "xy", 0, -1),
                        manualMoveButton("dir225", "caret-up", "xy", -1, -1),
                        manualMoveButton("dir270", "caret-up", "xy", -1, 0),
                        manualMoveButton("dir315", "caret-up", "xy", -1, 1),
                        BUTTON("position", [
                            DIV("x dimension").text("-"),
                            DIV("y dimension").text("-")
                        ]).click(() => wg.common.check(async () => await wg.machine.resetUserOrigin()))
                    ])
                ]),
                DIV("group zaxis", [
                    DIV("title").text("Z axis"),
                    DIV("buttons", [
                        BUTTON("start").text("START").click(() => wg.common.check(async () => await wg.router.start() /*await wg.machine.manualSwitch("spindle", true)*/)),
                        BUTTON("stop").text("STOP").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", false))),
                        DIV("spindle", [ICON("asterisk")]),
                        DIV("position dimension").text("-"),
                        manualMoveButton("up", "caret-up", "z", -1),
                        manualMoveButton("down", "caret-down", "z", 1)
                    ])
                ])
            ])
            .onMachineStateChanged(updateMachineState)
            .onRouterJobChanged(updateRouterJob)
            ,
        ]);

        updateMachineState(await wg.machine.getState());
        updateRouterJob(await wg.router.getCode());
    }
}

wg.pages.jobs = {
    async render(container, pageName) {
        wg.common.page(container, pageName, []);
    }
}

wg.pages.calibration = {
    async render(container, pageName) {
        wg.common.page(container, pageName, []);
    }
}

wg.pages.settings = {
    async render(container, pageName) {
        wg.common.page(container, pageName, []);
    }
}