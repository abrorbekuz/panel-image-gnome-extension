// extension.js
import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// Get Quick Settings elements
let QuickSettingsMenu = null;
let QuickSettingsBox = null;
let QuickSettingsActor = null;

function getQuickSettings() {
  const quickSettings = Main.panel.statusArea.quickSettings;
  if (quickSettings && quickSettings.menu) {
    QuickSettingsMenu = quickSettings.menu;
    QuickSettingsBox = quickSettings.menu.box;
    QuickSettingsActor = quickSettings.menu.actor;
  }
}

function cssUrl(path) {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Image banner widget
const ImageBanner = GObject.registerClass(
  class ImageBanner extends St.Button {
    _init(settings, standalone = false) {
      super._init({
        style_class: "image-banner",
        can_focus: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this._settings = settings;
      this._standalone = standalone;
      this._marginStyle = "";
      this._currentImageIndex = 0;
      this._hoverImages = [];

      // Create container (holds the image)
      this._container = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this.set_child(this._container);

      // Update image
      this._updateImage();

      // Setup hover image switching
      this._setupHoverEffect();

      // Connect click event
      this.connect("clicked", () => {
        this._executeScript();
      });

      // Listen for settings changes
      this._settingsChangedId = this._settings.connect("changed", () => {
        this._updateImage();
        this._setupHoverEffect();
      });
    }

    // Margin comes from the extension (gap), the rest from settings
    setMargin(css) {
      this._marginStyle = css;
      this._applyFrameStyle();
    }

    // Outer frame: fill color, border, rounded corners
    _applyFrameStyle() {
      const radius = this._settings.get_boolean("rounded-corners") ? 16 : 0;
      const fill = this._settings.get_string("fill-color");
      const borderWidth = this._settings.get_int("border-width");
      const borderColor =
        this._settings.get_string("border-color") || "rgba(255,255,255,0.25)";

      let css = `${this._marginStyle} border-radius: ${radius}px;`;
      if (fill) css += ` background-color: ${fill};`;
      if (borderWidth > 0)
        css += ` border: ${borderWidth}px solid ${borderColor};`;
      this.style = css;
    }

    // Images list: default image first, then the others
    _getImages() {
      const list = this._settings.get_strv("images").filter((p) => p);
      if (list.length === 0) return [];
      const def = this._settings.get_string("default-image");
      const first = list.includes(def) ? def : list[0];
      return [first, ...list.filter((p) => p !== first)];
    }

    _buildStyle(imagePath) {
      const height = this._settings.get_int("image-height");
      let width = this._settings.get_int("image-width");
      const radius = this._settings.get_boolean("rounded-corners") ? 16 : 0;

      if (this._standalone) {
        // -1 (or too big) = screen width. CSS px are scaled by the shell,
        // so divide the monitor width by the scale factor.
        const monitor = Main.layoutManager.primaryMonitor;
        const sf = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const screenW = Math.floor(monitor.width / sf);
        width = width > 0 ? Math.min(width, screenW) : screenW;
      }

      this._container.x_align =
        width > 0 ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;

      return `
        background-image: url("${cssUrl(imagePath)}");
        background-size: 100% 100%;
        background-repeat: no-repeat;
        background-position: center;
        border-radius: ${radius}px;
        min-height: ${height > 0 ? height : 100}px;
        width: ${width > 0 ? width + "px" : "100%"};
      `;
    }

    _setupHoverEffect() {
      // Disconnect previous handlers
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }

      this._hoverImages = [];

      if (!this._settings.get_boolean("hover-images-enabled")) return;

      const all = this._getImages();
      if (all.length < 2) return;

      this._hoverImages = all;

      // Connect motion event for hover tracking
      this._motionEventId = this.connect("motion-event", (actor, event) => {
        return this._onMotionEvent(actor, event);
      });

      // Reset to default image on leave
      this._leaveEventId = this.connect("leave-event", () => {
        this._currentImageIndex = 0;
        this._updateImage();
      });
    }

    _onMotionEvent(actor, event) {
      if (this._hoverImages.length === 0) {
        return Clutter.EVENT_PROPAGATE;
      }

      // Get mouse position relative to the banner
      const [x, y] = event.get_coords();
      const [actorX, actorY] = actor.get_transformed_position();
      const [width, height] = actor.get_size();

      // Calculate relative position (0 to 1)
      const relativeX = (x - actorX) / width;

      // Determine which image to show based on horizontal position
      const imageIndex = Math.floor(relativeX * this._hoverImages.length);
      const clampedIndex = Math.max(
        0,
        Math.min(imageIndex, this._hoverImages.length - 1),
      );

      // Only update if changed
      if (clampedIndex !== this._currentImageIndex) {
        this._currentImageIndex = clampedIndex;
        this._showHoverImage(this._hoverImages[clampedIndex]);
      }

      return Clutter.EVENT_PROPAGATE;
    }

    _showHoverImage(imagePath) {
      const file = Gio.File.new_for_path(imagePath);

      if (file.query_exists(null)) {
        this._container.child = null;
        this._container.style = this._buildStyle(imagePath);
      }
    }

    _updateImage() {
      this._applyFrameStyle();

      const imagePath = this._getImages()[0];

      if (!imagePath) {
        this._container.style = "";
        this._container.child = new St.Label({
          text: "No image. Add one in the extension preferences.",
          style_class: "image-placeholder",
        });
        return;
      }

      const file = Gio.File.new_for_path(imagePath);

      if (file.query_exists(null)) {
        this._container.child = null;
        this._container.style = this._buildStyle(imagePath);
      } else {
        this._container.style = "";
        this._container.child = new St.Label({
          text: "Image not found: " + imagePath,
          style_class: "image-placeholder",
        });
      }
    }

    _executeScript() {
      const scriptPath = this._settings.get_string("script-path");
      if (!scriptPath || scriptPath === "") {
        return;
      }

      try {
        GLib.spawn_command_line_async(scriptPath);
      } catch (e) {
        log(`Error executing script: ${e.message}`);
      }
    }

    destroy() {
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      super.destroy();
    }
  },
);

// Main extension class
export default class ImageQuickSettingsExtension extends Extension {
  enable() {
    this._settings = this.getSettings();

    getQuickSettings();

    this._origBoxStyle = QuickSettingsBox.style;
    this._addBanner();
    this._applyWidth();
    this._addStandalone();

    // Listen for settings changes
    // (image, colors, border, corners update live inside ImageBanner)
    this._settingsChangedIds = [
      this._settings.connect("changed::quick-settings-width", () =>
        this._applyWidth(),
      ),
      this._settings.connect("changed::position", () => {
        this._reload();
        this._applyWidth();
        this._addStandalone();
      }),
      this._settings.connect("changed::gap", () => this._reload()),
      this._settings.connect("changed::panel-button-icon", () =>
        this._addStandalone(),
      ),
      this._settings.connect("changed::panel-button-position", () =>
        this._addStandalone(),
      ),
    ];
  }

  _applyWidth() {
    const standalone = this._settings.get_string("position") === "standalone";
    const w = standalone ? 0 : this._settings.get_int("quick-settings-width");
    QuickSettingsBox.style = w > 0 ? `width: ${w}px;` : this._origBoxStyle;
  }

  _addBanner() {
    // position values: top, bottom, top-detached, bottom-detached, standalone
    const mode = this._settings.get_string("position");
    if (mode === "standalone") return;

    const detached = mode.endsWith("-detached");
    const position = mode.startsWith("bottom") ? "bottom" : "top";
    const gap = this._settings.get_int("gap");

    // Create banner
    this._banner = new ImageBanner(this._settings);

    // Store original style classes
    this._originalBoxStyle = QuickSettingsBox.style_class;
    this._originalActorStyle = QuickSettingsActor.style_class;

    if (detached) {
      // Detached mode: manipulate style classes like the reference extension
      QuickSettingsBox.style_class = "";
      QuickSettingsActor.style_class = " " + QuickSettingsActor.style_class;

      // Get the first child (the actual quick settings grid)
      const quickSettingsGrid = QuickSettingsBox.first_child;

      if (quickSettingsGrid) {
        // Store original grid style
        this._originalGridStyle = quickSettingsGrid.style_class;
        quickSettingsGrid.style_class =
          quickSettingsGrid.style_class + " popup-menu-content quick-settings";

        // Add banner based on position
        if (position === "top") {
          // Insert at the beginning
          QuickSettingsBox.insert_child_at_index(this._banner, 0);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.setMargin(`margin-bottom: ${gap}px;`);
        } else {
          // Bottom: add banner after the grid
          QuickSettingsBox.add_child(this._banner);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.setMargin(`margin-top: ${gap}px;`);
        }
      }
    } else {
      // Integrated mode: add directly to QuickSettingsBox (menu.box)
      // This places it as a real child in the vertical layout, not overlapping
      if (position === "top") {
        QuickSettingsBox.insert_child_at_index(this._banner, 0);
        this._banner.setMargin(`margin-bottom: ${gap}px;`);
      } else {
        QuickSettingsBox.add_child(this._banner);
        this._banner.setMargin(`margin-top: ${gap}px;`);
      }
    }
  }

  _reload() {
    this._removeBanner();
    this._addBanner();
  }

  _removeBanner() {
    if (this._banner) {
      const parent = this._banner.get_parent();
      if (parent) {
        parent.remove_child(this._banner);
      }
      this._banner.destroy();
      this._banner = null;
    }

    // Restore original styles
    if (this._originalBoxStyle) {
      QuickSettingsBox.style_class = this._originalBoxStyle;
      this._originalBoxStyle = null;
    }

    if (this._originalActorStyle) {
      QuickSettingsActor.style_class = this._originalActorStyle;
      this._originalActorStyle = null;
    }

    if (this._originalGridStyle) {
      const quickSettingsGrid = QuickSettingsBox.first_child;
      if (quickSettingsGrid) {
        quickSettingsGrid.style_class = this._originalGridStyle;
      }
      this._originalGridStyle = null;
    }
  }

  // ---- Standalone mode: panel button that opens the image on its own ----

  _addStandalone() {
    this._removeStandalone();
    if (this._settings.get_string("position") !== "standalone") return;

    const button = new PanelMenu.Button(0.0, "Panel Image Button", true);
    const iconStr = this._settings.get_string("panel-button-icon");
    const icon = new St.Icon({ style_class: "system-status-icon" });
    if (iconStr.startsWith("/")) icon.gicon = Gio.icon_new_for_string(iconStr);
    else icon.icon_name = iconStr || "image-x-generic-symbolic";
    button.add_child(icon);

    // PanelMenu.Button overrides the event vfunc, so hook "event" directly
    button.connect("event", (_actor, event) => {
      const type = event.type();
      if (
        type === Clutter.EventType.BUTTON_PRESS ||
        type === Clutter.EventType.TOUCH_BEGIN
      ) {
        this._toggleFloating();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    const side = this._settings.get_string("panel-button-position");
    Main.panel.addToStatusArea(`${this.uuid}-button`, button, 0, side);
    this._panelButton = button;

    this._floating = new ImageBanner(this._settings, true);
    this._floating.hide();
    this._floating.connect("clicked", () => this._closeFloating());
    Main.layoutManager.addTopChrome(this._floating);
  }

  _toggleFloating() {
    if (!this._floating) return;

    if (this._floating.visible) {
      this._closeFloating();
      return;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    this._floating.show();
    const [, w] = this._floating.get_preferred_width(-1);
    const [bx] = this._panelButton.get_transformed_position();
    const x = Math.max(monitor.x, Math.min(bx, monitor.x + monitor.width - w));
    this._floating.set_position(x, monitor.y + Main.panel.height);

    // Close on any click outside the image / panel button
    this._outsideId = global.stage.connect("captured-event", (_a, event) => {
      if (event.type() !== Clutter.EventType.BUTTON_PRESS)
        return Clutter.EVENT_PROPAGATE;
      const src = event.get_source();
      if (
        src &&
        !this._floating.contains(src) &&
        !this._panelButton.contains(src)
      )
        this._closeFloating();
      return Clutter.EVENT_PROPAGATE;
    });
  }

  _closeFloating() {
    if (this._outsideId) {
      global.stage.disconnect(this._outsideId);
      this._outsideId = null;
    }
    if (this._floating) this._floating.hide();
  }

  _removeStandalone() {
    this._closeFloating();
    if (this._floating) {
      Main.layoutManager.removeChrome(this._floating);
      this._floating.destroy();
      this._floating = null;
    }
    if (this._panelButton) {
      this._panelButton.destroy();
      this._panelButton = null;
    }
  }

  disable() {
    if (this._settingsChangedIds) {
      this._settingsChangedIds.forEach((id) => this._settings.disconnect(id));
      this._settingsChangedIds = null;
    }
    QuickSettingsBox.style = this._origBoxStyle;
    this._removeStandalone();
    this._removeBanner();
    this._settings = null;
  }
}
