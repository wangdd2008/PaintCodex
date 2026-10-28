/* Quiz widget: immediate feedback, no answer hints before the click.
   Markup contract:
   <div class="quiz" data-quiz data-explain="...">
     <p class="quiz-q"><span class="qnum">01</span> ...</p>
     <div class="quiz-options">
       <button class="quiz-option" data-correct="true"><span class="mark">A</span> ...</button>
       ...
     </div>
     <p class="quiz-feedback" aria-live="polite"></p>
   </div>
*/
(function () {
  "use strict";

  var sets = document.querySelectorAll("[data-quiz-set]");

  function labelFor(index) {
    return String.fromCharCode(65 + index);
  }

  function answer(quiz, chosen) {
    if (quiz.dataset.answered === "true") {
      return;
    }

    var options = Array.prototype.slice.call(
      quiz.querySelectorAll(".quiz-option")
    );
    var isCorrect = chosen.dataset.correct === "true";

    quiz.dataset.answered = "true";
    quiz.dataset.correct = isCorrect ? "true" : "false";

    options.forEach(function (option) {
      option.disabled = true;
      option.setAttribute("aria-pressed", option === chosen ? "true" : "false");

      if (option.dataset.correct === "true") {
        option.classList.add("is-answer");
        var mark = option.querySelector(".mark");
        if (mark) {
          mark.textContent = "✓";
        }
      }
    });

    chosen.classList.add(isCorrect ? "is-correct" : "is-wrong");

    if (!isCorrect) {
      var wrongMark = chosen.querySelector(".mark");
      if (wrongMark) {
        wrongMark.textContent = "✗";
      }
    }

    var feedback = quiz.querySelector(".quiz-feedback");
    if (feedback) {
      var verdict = document.createElement("span");
      verdict.className = "verdict " + (isCorrect ? "verdict--ok" : "verdict--no");
      verdict.textContent = isCorrect ? "对了。" : "不对。";

      feedback.appendChild(verdict);
      feedback.appendChild(
        document.createTextNode(" " + (quiz.dataset.explain || ""))
      );
    }

    updateScore(quiz);
  }

  function updateScore(quiz) {
    var set = quiz.closest("[data-quiz-set]");
    if (!set) {
      return;
    }

    var score = set.querySelector(".quiz-score");
    var total = set.querySelectorAll("[data-quiz]").length;
    var answered = set.querySelectorAll('[data-quiz][data-answered="true"]').length;

    if (!score || answered < total) {
      return;
    }

    var correct = set.querySelectorAll(
      '[data-quiz][data-correct="true"]'
    ).length;
    var message =
      "答对 " +
      correct +
      " / " +
      total +
      "。把错的那题用自己的话讲一遍，再往下走。";

    score.textContent = message;
  }

  document.querySelectorAll("[data-quiz]").forEach(function (quiz) {
    var options = quiz.querySelectorAll(".quiz-option");

    options.forEach(function (option, index) {
      var mark = option.querySelector(".mark");
      if (mark && !mark.textContent.trim()) {
        mark.textContent = labelFor(index);
      }

      option.addEventListener("click", function () {
        answer(quiz, option);
      });
    });
  });
})();
