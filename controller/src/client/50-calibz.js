wg.pages.calibz = {
    async render(container, pageName) {
        wg.common.page(container, pageName, [
            H1().text("Calibration Z"),
            DIV().text("1. Use buttons to move spindle in Z axis."),
            DIV().text("2. Measure the distance from bottom surface of the sled to the end of the spindle tool."),
            DIV().text("3. Save the calibration."),

            DIV("scene", [
                DIV("group z", [
                    DIV("title").text("Z"),
                    wg.common.manualMoveButton("a up", "caret-up", "z", -1),
                    wg.common.manualMoveButton("a down", "caret-down", "z", 1)
                ]),
                DIV("group distance", [
                    DIV("title").text("distance"),
                    DIV("form", [
                        INPUT(),
                        DIV("dimension"),
                        BUTTON().text("Save").click(() => {
                            wg.common.check(async () => {
                                await wg.machine.setCalibrationZ(-parseInt($(".distance input").val()))
                                $(".distance input").val("");
                                await wg.goto("home");
                            });
                        })
                    ])
                ])

            ])


        ]);
    }
}
