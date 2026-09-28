// The cake on a birthday event's pill.
//
// Its own component rather than a glyph typed into each title because it
// appears in two places that render titles quite differently — the calendar's
// per-day pills and the agenda's — and because the alternative, baking the
// emoji into the event title the server sends, quietly reorders the day: all-day
// events are sorted among themselves by title, and a leading emoji sorts after
// the alphanumerics, so every birthday on a day would sink to the bottom of it.
//
// Decorative by design, hence aria-hidden: the title beside it already says
// whose birthday it is, and a screen reader announcing "birthday cake" before
// every one of them is noise rather than information. It disappears in privacy
// mode along with the title it decorates, for the same reason titles do.
export default function BirthdayMark() {
  return (
    <span className="birthday-mark" aria-hidden="true">
      🎂
    </span>
  );
}
