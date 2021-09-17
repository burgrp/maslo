wg.pages.calibxy = {
    async render(container, pageName) {
        wg.common.page(container, pageName, [
            H1().text("Calibration XY"),
            DIV().text("1. Align sled to center line using A and B buttons."),
            DIV().text("2. Measure distance from top of workspace to top of sled."),
            DIV().text("3. Save the calibration."),

            DIV("scene", [
                DIV("group a", [
                    DIV("title").text("A"),
                    wg.common.manualMoveButton("a up", "caret-up", "a", -1),
                    wg.common.manualMoveButton("a down", "caret-down", "a", 1)
                ]),
                DIV("group distance", [
                    DIV("title").text("distance"),
                    DIV("form", [
                        INPUT(),
                        DIV("dimension"),
                        BUTTON().text("Save").click(() => {
                            wg.common.check(async () => {
                                await wg.machine.setCalibrationXY(parseInt($(".distance input").val()))
                                await wg.goto("home");
                            });
                        })
                    ])
                ]),
                DIV("group b", [
                    DIV("title").text("B"),
                    wg.common.manualMoveButton("b up", "caret-up", "b", -1),
                    wg.common.manualMoveButton("b down", "caret-down", "b", 1)
                ])

            ])


        ]);
    }
}
