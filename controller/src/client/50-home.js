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
                    ])
                ])
            ]),
            DIV("content", content)
        ]));
    },

    showError(error) {
        alert(error);
        console.error("showError", error);
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

        function updateMachineState(state) {

            let sledX = state.sledPosition && state.sledPosition.xmm;
            let sledY = state.sledPosition && state.sledPosition.ymm;

            console.info("Machine state changed:", state);

            $(".xyaxis .position .x").text(sledX === undefined ? "?" : Math.round((sledX - state.userOrigin.xmm) * 10) / 10);
            $(".xyaxis .position .y").text(sledY === undefined ? "?" : -Math.round((sledY - state.userOrigin.ymm) * 10) / 10);
            $(".zaxis .position").text(state.zPosMm);
            $(".zaxis .spindle").toggleClass("on", state.spindle.on);

            $(".scene svg").attr({ viewBox: `-${state.motorShaftDistanceMm / 2 + 100} -100 ${state.motorShaftDistanceMm + 200} 1` });

            $(".scene .motor.a").attr({
                cx: -state.motorShaftDistanceMm / 2
            });

            $(".scene .motor.b").attr({
                cx: state.motorShaftDistanceMm / 2
            });

            $(".scene .workspace").attr({
                x: -state.workspaceWidthMm / 2,
                y: state.motorToWorkspaceVerticalMm,
                width: state.workspaceWidthMm,
                height: state.workspaceHeightMm
            });

            $(".scene .sled").attr({
                cx: sledX,
                cy: sledY,
            });

            $(".scene .userorigin.x").attr({
                x1: state.userOrigin.xmm - 30,
                y1: state.userOrigin.ymm,
                x2: state.userOrigin.xmm + 100,
                y2: state.userOrigin.ymm
            });

            $(".scene .userorigin.y").attr({
                x1: state.userOrigin.xmm,
                y1: state.userOrigin.ymm - 100,
                x2: state.userOrigin.xmm,
                y2: state.userOrigin.ymm + 30
            });

            $(".scene .chain, .scene .sled").attr({
                visibility: state.sledPosition ? "visible" : "hidden"
            });


            $(".scene .chain.a").attr({
                x1: sledX,
                y1: sledY,
                x2: -state.motorShaftDistanceMm / 2,
                y2: 0
            });

            $(".scene .chain.b").attr({
                x1: sledX,
                y1: sledY,
                x2: state.motorShaftDistanceMm / 2,
                y2: 0
            });

            $(".scene").css({ visibility: "visible" });

            $(".state").text(JSON.stringify(state, null, 2));


        }


        function moveButton(clazz, icon, kind, ...moveArgs) {
            let button = BUTTON(clazz, [ICON(icon)]);
            let isDown = false;

            function down() {
                if (!isDown) {
                    isDown = true;
                    console.info("start move", ...moveArgs);
                    wg.common.check(async () => await wg.machine.manualMoveStart(kind, ...moveArgs));
                }
            }

            function up() {
                if (isDown) {
                    isDown = false;
                    console.info("stop move", ...moveArgs);
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

            button.on("touchstart", () => {
                console.info("1");
            })

            return button;
        }

        wg.common.page(container, pageName, [
            DIV("scene", [$(`
            <svg preserveAspectRatio="xMinYMin" width="100%" xmlns="http://www.w3.org/2000/svg">
                <circle class="motor a" cy="0" r="50" fill="red"/>
                <circle class="motor b" cy="0" r="50" fill="red"/>
                <rect class="workspace" fill="none" stroke="silver" stroke-width="10"/>
                <circle class="sled center" r="50" fill="red"/>
                <circle class="sled outline" r="125" fill="none" stroke="gray" stroke-width="20"/>
                <line class="chain a" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="chain b" stroke="gray" stroke-width="10" stroke-dasharray="10"/>
                <line class="userorigin x" stroke="yellow" stroke-width="10"/>
                <line class="userorigin y" stroke="yellow" stroke-width="10"/>
            </svg>                      
            `)]).css({ visibility: "hidden" }),
            DIV("state"),
            DIV("controls", [
                DIV("group abchains", [
                    DIV("title").text("chains"),
                    DIV("buttons", [
                        DIV("a side").text("A"),
                        moveButton("a up", "caret-up", "a", -1),
                        moveButton("a down", "caret-down", "a", 1),
                        DIV("b side").text("B"),
                        moveButton("b up", "caret-up", "b", -1),
                        moveButton("b down", "caret-down", "b", 1)
                    ])
                ]),
                DIV("group xyaxis", [
                    DIV("title").text("X,Y axis"),
                    DIV("buttons", [
                        moveButton("dir0", "caret-up", "xy", 0, -1),
                        moveButton("dir45", "caret-up", "xy", 1, -1),
                        moveButton("dir90", "caret-up", "xy", 1, 0),
                        moveButton("dir135", "caret-up", "xy", 1, 1),
                        moveButton("dir180", "caret-up", "xy", 0, 1),
                        moveButton("dir225", "caret-up", "xy", -1, 1),
                        moveButton("dir270", "caret-up", "xy", -1, 0),
                        moveButton("dir315", "caret-up", "xy", -1, -1),
                        BUTTON("position", [
                            DIV("x dimension").text("-"),
                            DIV("y dimension").text("-")
                        ]).click(() => wg.common.check(async () => await wg.machine.resetUserOrigin()))
                    ])
                ]),
                DIV("group zaxis", [
                    DIV("title").text("Z axis"),
                    DIV("buttons", [
                        BUTTON("start").text("START").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", true))),
                        BUTTON("stop").text("STOP").click(() => wg.common.check(async () => await wg.machine.manualSwitch("spindle", false))),
                        DIV("spindle", [ICON("asterisk")]),
                        DIV("position dimension").text("-"),
                        moveButton("up", "caret-up", "z", -1),
                        moveButton("down", "caret-down", "z", 1)
                    ])
                ])
            ]).onMachineStateChanged(updateMachineState)
        ]);

        updateMachineState(await wg.machine.getState());
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