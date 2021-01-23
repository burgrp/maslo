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
            console.info("Machine state changed:", state);
            $(".xyaxis .position .x").text(state.xPosMm);
            $(".xyaxis .position .y").text(state.yPosMm);
            $(".zaxis .position").text(state.zPosMm);
            $(".zaxis .spindle").toggleClass("on", state.spindleOn);
            $(".scene").text(JSON.stringify(state, null, 2));

        }


        function moveButton(clazz, icon, kind, ...moveArgs) {
            let button = BUTTON(clazz, [ICON(icon)]);
            let isDown = false;

            function down() {
                if (!isDown) {
                    isDown = true;
                    console.info("start move", ...moveArgs);
                    wg.common.check(async () => await wg.machine.moveStart(kind, ...moveArgs));
                }
            }

            function up() {
                if (isDown) {
                    isDown = false;
                    console.info("stop move", ...moveArgs);
                    wg.common.check(async () => await wg.machine.moveStop(kind));
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
            DIV("scene"),
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
                        ]).click(() => wg.common.check(async () => await wg.machine.resetOrigin()))
                    ])
                ]),
                DIV("group zaxis", [
                    DIV("title").text("Z axis"),
                    DIV("buttons", [
                        BUTTON("start").text("START").click(() => wg.common.check(async () => await wg.machine.switch("spindle", true))),
                        BUTTON("stop").text("STOP").click(() => wg.common.check(async () => await wg.machine.switch("spindle", false))),
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