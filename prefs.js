// prefs.js
import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|tiff?)$/i;

export default class ImageQuickSettingsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window.set_default_size(580, 760);

    const page = new Adw.PreferencesPage();
    window.add(page);

    // ---------- helpers ----------

    const imageFilters = () => {
      const filter = new Gtk.FileFilter({ name: "Images" });
      filter.add_mime_type("image/*");
      const store = new Gio.ListStore({ item_type: Gtk.FileFilter.$gtype });
      store.append(filter);
      return [store, filter];
    };

    // pick many images
    const chooseImages = (onPick) => {
      const dialog = new Gtk.FileDialog({
        title: "Choose images",
        modal: true,
      });
      const [store, filter] = imageFilters();
      dialog.set_filters(store);
      dialog.set_default_filter(filter);
      dialog.open_multiple(window, null, (d, res) => {
        try {
          const files = d.open_multiple_finish(res);
          const paths = [];
          for (let i = 0; i < files.get_n_items(); i++)
            paths.push(files.get_item(i).get_path());
          onPick(paths);
        } catch (_e) {
          // cancelled
        }
      });
    };

    // pick one file (icon / script)
    const chooseFile = (title, imagesOnly, onPick) => {
      const dialog = new Gtk.FileDialog({ title, modal: true });
      if (imagesOnly) {
        const [store, filter] = imageFilters();
        dialog.set_filters(store);
        dialog.set_default_filter(filter);
      }
      dialog.open(window, null, (d, res) => {
        try {
          const file = d.open_finish(res);
          if (file) onPick(file.get_path());
        } catch (_e) {
          // cancelled
        }
      });
    };

    const pickButton = (tooltip, onClick) => {
      const btn = new Gtk.Button({
        icon_name: "document-open-symbolic",
        valign: Gtk.Align.CENTER,
        tooltip_text: tooltip,
        css_classes: ["flat"],
      });
      btn.connect("clicked", onClick);
      return btn;
    };

    const spinRow = (title, subtitle, key, lower, upper, page_inc = 10) => {
      const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
          lower,
          upper,
          step_increment: 1,
          page_increment: page_inc,
        }),
      });
      settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
      return row;
    };

    // color picker with reset (empty = theme default)
    const colorRow = (title, key) => {
      const row = new Adw.ActionRow({ title });
      const btn = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ with_alpha: true }),
        valign: Gtk.Align.CENTER,
      });
      const reset = new Gtk.Button({
        icon_name: "edit-clear-symbolic",
        valign: Gtk.Align.CENTER,
        tooltip_text: "Back to default",
        css_classes: ["flat"],
      });
      let syncing = false;

      const sync = () => {
        const str = settings.get_string(key);
        const rgba = new Gdk.RGBA();
        if (!str || !rgba.parse(str)) rgba.parse("rgba(0,0,0,0)");
        syncing = true;
        btn.set_rgba(rgba);
        syncing = false;
        row.subtitle = str ? "" : "Default";
        reset.sensitive = !!str;
      };

      btn.connect("notify::rgba", () => {
        if (syncing) return;
        settings.set_string(key, btn.get_rgba().to_string());
      });
      reset.connect("clicked", () => settings.set_string(key, ""));
      settings.connect(`changed::${key}`, sync);
      sync();

      row.add_suffix(reset);
      row.add_suffix(btn);
      return row;
    };

    // ---------- Display ----------

    const displayGroup = new Adw.PreferencesGroup({ title: "Display" });
    page.add(displayGroup);

    const modes = [
      "top",
      "bottom",
      "top-detached",
      "bottom-detached",
      "standalone",
    ];
    const modeRow = new Adw.ComboRow({
      title: "Mode",
      subtitle: "Standalone = own panel button, image opens by itself",
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
    displayGroup.add(modeRow);

    const hoverRow = new Adw.SwitchRow({
      title: "Hover gallery",
      subtitle:
        "Move the mouse across the image to switch images (needs 2+ images)",
    });
    settings.bind(
      "hover-images-enabled",
      hoverRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    displayGroup.add(hoverRow);

    // ---------- Images (drag & drop) ----------

    const imagesGroup = new Adw.PreferencesGroup({
      title: "Images",
      description:
        "Drag & drop images anywhere in this window. Pick one as Default, the rest play on hover.",
    });
    page.add(imagesGroup);

    const addRow = new Adw.ActionRow({
      title: "Add images",
      subtitle: "Click here or drop files",
    });
    const addBtn = new Gtk.Button({
      icon_name: "list-add-symbolic",
      valign: Gtk.Align.CENTER,
      css_classes: ["flat"],
    });
    addRow.add_suffix(addBtn);
    addRow.activatable_widget = addBtn;
    imagesGroup.add(addRow);

    const addPaths = (paths) => {
      const list = settings.get_strv("images");
      let changed = false;
      for (const p of paths) {
        if (p && IMAGE_RE.test(p) && !list.includes(p)) {
          list.push(p);
          changed = true;
        }
      }
      if (changed) settings.set_strv("images", list);
    };

    addBtn.connect("clicked", () => chooseImages(addPaths));

    // drop target on the whole window
    const drop = Gtk.DropTarget.new(Gdk.FileList.$gtype, Gdk.DragAction.COPY);
    drop.connect("drop", (_target, value) => {
      const files = value.get_files();
      addPaths(files.map((f) => f.get_path()).filter((p) => p));
      return true;
    });
    window.add_controller(drop);

    let imageRows = [];
    const rebuildImages = () => {
      imageRows.forEach((r) => imagesGroup.remove(r));
      imageRows = [];

      const list = settings.get_strv("images");
      const def = settings.get_string("default-image");
      const defPath = list.includes(def) ? def : list[0];
      let firstCheck = null;

      list.forEach((path) => {
        const exists = GLib.file_test(path, GLib.FileTest.EXISTS);
        const row = new Adw.ActionRow({
          title: GLib.path_get_basename(path),
          subtitle: exists ? "" : "File missing",
          tooltip_text: path,
        });

        if (exists) {
          const pic = Gtk.Picture.new_for_filename(path);
          pic.set_size_request(64, 40);
          pic.content_fit = Gtk.ContentFit.COVER;
          pic.valign = Gtk.Align.CENTER;
          row.add_prefix(pic);
        }

        const check = new Gtk.CheckButton({
          label: "Default",
          valign: Gtk.Align.CENTER,
          active: path === defPath,
        });
        if (firstCheck) check.set_group(firstCheck);
        else firstCheck = check;
        check.connect("toggled", () => {
          if (check.active) settings.set_string("default-image", path);
        });
        row.add_suffix(check);

        const del = new Gtk.Button({
          icon_name: "user-trash-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: "Remove",
          css_classes: ["flat"],
        });
        del.connect("clicked", () => {
          if (settings.get_string("default-image") === path)
            settings.set_string("default-image", "");
          settings.set_strv(
            "images",
            settings.get_strv("images").filter((p) => p !== path),
          );
        });
        row.add_suffix(del);

        imagesGroup.add(row);
        imageRows.push(row);
      });
    };
    settings.connect("changed::images", rebuildImages);
    rebuildImages();

    // ---------- Collapsible options ----------

    const moreGroup = new Adw.PreferencesGroup({ title: "Customize" });
    page.add(moreGroup);

    const expander = (title, subtitle) => {
      const row = new Adw.ExpanderRow({ title, subtitle });
      moreGroup.add(row);
      return row;
    };

    // Size & shape
    const shapeExp = expander("Size & Shape", "Width, height, corners");
    shapeExp.add_row(
      spinRow(
        "Image width",
        "-1 = full width (screen width in standalone)",
        "image-width",
        -1,
        8192,
      ),
    );
    shapeExp.add_row(
      spinRow("Image height", "Pixels", "image-height", 0, 4096),
    );
    const roundedRow = new Adw.SwitchRow({ title: "Rounded corners" });
    settings.bind(
      "rounded-corners",
      roundedRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    shapeExp.add_row(roundedRow);

    // Colors
    const colorExp = expander(
      "Colors",
      "Fill shows where the image is narrower than the banner",
    );
    colorExp.add_row(colorRow("Fill color", "fill-color"));
    colorExp.add_row(colorRow("Border color", "border-color"));
    colorExp.add_row(
      spinRow("Border width", "0 = no border", "border-width", 0, 20, 2),
    );

    // Quick Settings
    const qsExp = expander("Quick Settings", "Menu width and gap");
    qsExp.add_row(
      spinRow(
        "Quick Settings width",
        "0 = default",
        "quick-settings-width",
        0,
        1200,
      ),
    );
    qsExp.add_row(
      spinRow(
        "Gap",
        "Space between image and the toggles (detached)",
        "gap",
        0,
        50,
        5,
      ),
    );

    // Panel button
    const btnExp = expander("Panel Button", "Standalone mode only");
    const iconRow = new Adw.EntryRow({ title: "Icon name or image" });
    settings.bind(
      "panel-button-icon",
      iconRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    iconRow.add_suffix(
      pickButton("Pick an image as icon", () =>
        chooseFile("Choose icon", true, (p) =>
          settings.set_string("panel-button-icon", p),
        ),
      ),
    );
    btnExp.add_row(iconRow);

    const sides = ["left", "center", "right"];
    const sideRow = new Adw.ComboRow({ title: "Panel side" });
    const sideModel = new Gtk.StringList();
    ["Left", "Center", "Right"].forEach((s) => sideModel.append(s));
    sideRow.set_model(sideModel);
    sideRow.set_selected(
      Math.max(0, sides.indexOf(settings.get_string("panel-button-position"))),
    );
    sideRow.connect("notify::selected", () => {
      settings.set_string(
        "panel-button-position",
        sides[sideRow.get_selected()],
      );
    });
    btnExp.add_row(sideRow);

    // Click action
    const scriptExp = expander(
      "Click Action",
      "Run a script when the image is clicked",
    );
    const scriptRow = new Adw.EntryRow({ title: "Script" });
    settings.bind(
      "script-path",
      scriptRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    scriptRow.add_suffix(
      pickButton("Pick a script", () =>
        chooseFile("Choose script", false, (p) =>
          settings.set_string("script-path", p),
        ),
      ),
    );
    scriptExp.add_row(scriptRow);

    // grey out what does not apply to the current mode
    const syncMode = () => {
      const standalone = settings.get_string("position") === "standalone";
      qsExp.sensitive = !standalone;
      btnExp.sensitive = standalone;
    };
    settings.connect("changed::position", syncMode);
    syncMode();
  }
}
