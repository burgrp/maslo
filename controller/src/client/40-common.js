/*---------------------------------------------------------------*/

function formatLength(mm) {
    return Number.isFinite(mm)? mm.toFixed(1): "-";
}

/*---------------------------------------------------------------*/

jQuery.event.special.touchstart = {
    setup: function( _, ns, handle ) {
        this.addEventListener("touchstart", handle, { passive: !ns.includes("noPreventDefault") });
    }
};
jQuery.event.special.touchmove = {
    setup: function( _, ns, handle ) {
        this.addEventListener("touchmove", handle, { passive: !ns.includes("noPreventDefault") });
    }
};
jQuery.event.special.wheel = {
    setup: function( _, ns, handle ){
        this.addEventListener("wheel", handle, { passive: true });
    }
};
jQuery.event.special.mousewheel = {
    setup: function( _, ns, handle ){
        this.addEventListener("mousewheel", handle, { passive: true });
    }
};

/*---------------------------------------------------------------*/

function ICON(glyph) {
    return $(`<i class="icon fas fa-${glyph}"/>`);
}

wg.common = {
    page(container, name, content) {

        let link = (linkName, path, icon) => AHREF(linkName + (linkName === name ? " active" : ""), { href: path }, [ICON(icon)]);

        container.append(DIV("page " + name, [
            DIV("navigation", [
                link("home", "/", "home"),
                //link("jobs", "jobs", "folder-open"),
                link("calibxy", "calibxy", "ruler-combined"),
                link("calibz", "calibz", "sort"),
                link("calibstretch", "calibstretch", "expand-alt"),
                link("settings", "settings", "tools"),
                DIV("end", [
                    BUTTON("stop", [
                        ICON("exclamation-triangle"),
                        DIV().text("STOP")
                    ]).click(() => wg.common.check(async () => await wg.machine.emergencyStop()))
                ])
            ]),
            DIV("content", content),
            DIV("errors", div => div.click(() => div.empty()))
        ]));
    },

    showError(error) {
        console.error("Error:", error);
        let alreadyDisplayed = $(".errors").get().map(ed => $(ed).text()).some(t => t === error);
        if (!alreadyDisplayed) {
            $(".page .errors").append(DIV().text(error.message || error));
        }
    },

    async check(asyncAction) {
        try {
            await asyncAction();
        } catch (error) {
            wg.common.showError(error);
        }
    },

    manualMoveButton(clazz, icon, kind, ...direction) {
        let button = BUTTON(clazz + " control standby", [ICON(icon)]);
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

}

/*---------------------------------------------------------------*/

wg.pages.settings = {
    async render(container, pageName) {
        wg.common.page(container, pageName, []);
    }
}