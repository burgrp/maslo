function ICON(glyph) {
    return $(`<i class="icon fas fa-${glyph}"/>`);
}

wg.common = {
    page(container, name, content) {

        let link = (linkName, path, icon) => AHREF(linkName + (linkName === name ? " active" : ""), { href: path }, [ICON(icon)]);

        container.append(DIV("page " + name, [
            DIV("navigation", [
                link("home", "/", "home"),
                link("jobs", "jobs", "briefcase"),
                link("calibration", "calibration", "compress"),
                link("settings", "settings", "tools"),
                DIV("end", [
                    BUTTON("stop", [
                        ICON("hand-paper"),
                        DIV().text("STOP")
                    ])
                ])
            ]),
            DIV("content", content)
        ]));
    }
}

wg.pages.home = {
    async render(container, pageName) {
        wg.common.page(container, pageName, [
            DIV("scene").text("SCENE"),
            DIV("controls", [
                DIV("group abmotors", [
                    DIV("title").text("motors"),
                    DIV("buttons", [
                        DIV("a side").text("A"),
                        BUTTON("a up", [ICON("caret-up")]),
                        BUTTON("a down", [ICON("caret-down")]),
                        DIV("b side").text("B"),
                        BUTTON("b up", [ICON("caret-up")]),
                        BUTTON("b down", [ICON("caret-down")])
                    ])
                ]),
                DIV("group xyaxis", [
                    DIV("title").text("X/Y axis"),
                    DIV("buttons", [
                        BUTTON("dir0", [ICON("caret-up")]),
                        BUTTON("dir45", [ICON("caret-up")]),
                        BUTTON("dir90", [ICON("caret-up")]),
                        BUTTON("dir135", [ICON("caret-up")]),
                        BUTTON("dir180", [ICON("caret-up")]),
                        BUTTON("dir225", [ICON("caret-up")]),
                        BUTTON("dir270", [ICON("caret-up")]),
                        BUTTON("dir315", [ICON("caret-up")])
                    ])
                ]),
                // DIV("zaxis", [
                //     DIV("title").text("Z axis"),
                //     DIV("motor", [
                //         DIV("title").text("spindle"),
                //         BUTTON().text("START"),
                //         BUTTON().text("STOP")
                //     ]),
                //     DIV("zaxis", [
                //         BUTTON([ICON("caret-up")]),
                //         BUTTON([ICON("caret-down")])
                //     ])
                // ])
            ])
        ])
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