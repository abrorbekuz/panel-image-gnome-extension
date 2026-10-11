// prefs.js
import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class ImageQuickSettingsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // Create a preferences page
    const page = new Adw.PreferencesPage();
    window.add(page);

    // Layout group
    const layoutGroup = new Adw.PreferencesGroup({
      title: "Layout Settings",
      description: "Configure how the image is displayed",
    });
    page.add(layoutGroup);

    // Mode row (replaces old Detached switch + Position)
    const modes = [
      "top",
      "bottom",
      "top-detached",
      "bottom-detached",
      "standalone",
    ];
    const modeRow = new Adw.ComboRow({
      title: "Mode",
    });
    const modeModel = new Gtk.StringList();
    [
      "Top",
      "Bottom",
      "Top (detached)",
      "Bottom (detached)",
      "Standalone button",
    ].forEach((s) => modeModel.append(s));
    modeRow.set_model(modeModel);
    modeRow.set_selected(
      Math.max(0, modes.indexOf(settings.get_string("position"))),
    );
    modeRow.connect("notify::selected", () => {
      settings.set_string("position", modes[modeRow.get_selected()]);
    });
    layoutGroup.add(modeRow);

    // Gap row
    const gapRow = new Adw.SpinRow({
      title: "Gap Size",
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 50,
        step_increment: 1,
        page_increment: 5,
      }),
    });
    settings.bind("gap", gapRow, "value", Gio.SettingsBindFlags.DEFAULT);
    layoutGroup.add(gapRow);

    // Rounded corners
    const roundedRow = new Adw.SwitchRow({
      title: "Rounded Corners",
    });
    settings.bind(
      "rounded-corners",
      roundedRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    layoutGroup.add(roundedRow);

    // Quick Settings width
    const qsWidthRow = new Adw.SpinRow({
      title: "Quick Settings Width",
      subtitle: "0 = default (not used in standalone mode)",
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 1200,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    settings.bind(
      "quick-settings-width",
      qsWidthRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    layoutGroup.add(qsWidthRow);

    // Image settings group
    const imageGroup = new Adw.PreferencesGroup({
      title: "Image Settings",
      description: "Configure the image banner",
    });
    page.add(imageGroup);

    // Image path
    const imagePathRow = new Adw.EntryRow({
      title: "Image Path",
    });
    settings.bind(
      "image-path",
      imagePathRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    imageGroup.add(imagePathRow);

    // Hover images section
    const hoverEnabledRow = new Adw.SwitchRow({
      title: "Enable Hover Images",
    });
    settings.bind(
      "hover-images-enabled",
      hoverEnabledRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    imageGroup.add(hoverEnabledRow);

    const hoverImagesRow = new Adw.EntryRow({
      title: "Hover Images Paths",
    });
    settings.bind(
      "hover-images",
      hoverImagesRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    imageGroup.add(hoverImagesRow);

    const hoverInfoRow = new Adw.ActionRow({
      title: "Comma-separated paths: /path/1.png,/path/2.png,/path/3.png",
    });
    imageGroup.add(hoverInfoRow);

    // Image width
    const widthRow = new Adw.SpinRow({
      title: "Image Width",
      adjustment: new Gtk.Adjustment({
        lower: -1,
        upper: 8192,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    settings.bind(
      "image-width",
      widthRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    imageGroup.add(widthRow);

    const widthInfo = new Adw.ActionRow({
      title: "Use -1 for full width (screen width in standalone mode)",
    });
    imageGroup.add(widthInfo);

    // Image height
    const heightRow = new Adw.SpinRow({
      title: "Banner Height",
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 4096,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    settings.bind(
      "image-height",
      heightRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    imageGroup.add(heightRow);

    const heightInfo = new Adw.ActionRow({
      title: "Use 0 for auto height",
    });
    imageGroup.add(heightInfo);

    // Panel button group (used in standalone mode)
    const btnGroup = new Adw.PreferencesGroup({
      title: "Panel Button",
      description: "Used in standalone mode",
    });
    page.add(btnGroup);

    const btnIconRow = new Adw.EntryRow({
      title: "Icon (name or full path)",
    });
    settings.bind(
      "panel-button-icon",
      btnIconRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    btnGroup.add(btnIconRow);

    const sides = ["left", "center", "right"];
    const btnPosRow = new Adw.ComboRow({
      title: "Panel Side",
    });
    const sideModel = new Gtk.StringList();
    ["Left", "Center", "Right"].forEach((s) => sideModel.append(s));
    btnPosRow.set_model(sideModel);
    btnPosRow.set_selected(
      Math.max(0, sides.indexOf(settings.get_string("panel-button-position"))),
    );
    btnPosRow.connect("notify::selected", () => {
      settings.set_string(
        "panel-button-position",
        sides[btnPosRow.get_selected()],
      );
    });
    btnGroup.add(btnPosRow);

    // Script settings group
    const scriptGroup = new Adw.PreferencesGroup({
      title: "Script Settings",
      description: "Execute a script when image is clicked",
    });
    page.add(scriptGroup);

    // Script path
    const scriptPathRow = new Adw.EntryRow({
      title: "Script Path",
    });
    settings.bind(
      "script-path",
      scriptPathRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    scriptGroup.add(scriptPathRow);

    // Info row
    const infoRow = new Adw.ActionRow({
      title: "Example: /home/user/script.sh",
    });
    scriptGroup.add(infoRow);
  }
}
