/* Stepper widget: one step visible at a time, deep-linkable, keyboard-friendly.
   Markup contract:
   <div class="stepper" data-stepper data-label="消息流">
     <header class="stepper-head">...</header>
     <div class="stepper-dots" role="tablist" aria-label="步骤"></div>
     <div class="stepper-stage">
       <section class="step" data-title="...">...</section>
       ...
     </div>
     <div class="stepper-nav">
       <button data-prev>上一行</button>
       <span class="stepper-hint">← →</span>
       <button data-next>下一行</button>
     </div>
   </div>
*/
(function () {
  "use strict";

  document.querySelectorAll("[data-stepper]").forEach(function (stepper) {
    var steps = Array.prototype.slice.call(
      stepper.querySelectorAll(".step")
    );
    if (steps.length === 0) {
      return;
    }

    var dotsHost = stepper.querySelector(".stepper-dots");
    var counter = stepper.querySelector("[data-count]");
    var prev = stepper.querySelector("[data-prev]");
    var next = stepper.querySelector("[data-next]");
    var current = 0;

    function readHash() {
      var match = /^#step-(\d+)$/.exec(window.location.hash);
      if (!match) {
        return 0;
      }
      var index = Number(match[1]) - 1;
      return index >= 0 && index < steps.length ? index : 0;
    }

    function renderDots() {
      if (!dotsHost) {
        return;
      }

      dotsHost.textContent = "";

      steps.forEach(function (step, index) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "dot";
        dot.textContent = String(index + 1).padStart(2, "0");
        dot.setAttribute(
          "aria-label",
          "第 " + (index + 1) + " 步：" + (step.dataset.title || "")
        );
        dot.addEventListener("click", function () {
          show(index);
        });
        dotsHost.appendChild(dot);
      });
    }

    function show(index, options) {
      var opts = options || {};
      current = Math.max(0, Math.min(index, steps.length - 1));

      steps.forEach(function (step, stepIndex) {
        var active = stepIndex === current;
        step.hidden = !active;
        step.classList.toggle("is-entering", active);

        var dots = dotsHost ? dotsHost.querySelectorAll(".dot") : [];
        if (dots[stepIndex]) {
          if (active) {
            dots[stepIndex].setAttribute("aria-current", "step");
          } else {
            dots[stepIndex].removeAttribute("aria-current");
          }
        }
      });

      if (counter) {
        counter.textContent =
          String(current + 1).padStart(2, "0") +
          " / " +
          String(steps.length).padStart(2, "0");
      }

      if (prev) {
        prev.disabled = current === 0;
      }

      if (next) {
        next.disabled = current === steps.length - 1;
      }

      if (opts.updateHash) {
        var hash = "#step-" + (current + 1);
        if (window.location.hash !== hash) {
          history.replaceState(null, "", hash);
        }
      }
    }

    renderDots();
    show(readHash(), { updateHash: false });

    if (prev) {
      prev.addEventListener("click", function () {
        show(current - 1, { updateHash: true });
      });
    }

    if (next) {
      next.addEventListener("click", function () {
        show(current + 1, { updateHash: true });
      });
    }

    stepper.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(current - 1, { updateHash: true });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        show(current + 1, { updateHash: true });
      }
    });

    window.addEventListener("hashchange", function () {
      show(readHash(), { updateHash: false });
    });
  });
})();
