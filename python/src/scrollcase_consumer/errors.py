"""Public consumer failures.

Callers need one stable error boundary without losing the concrete security reason. The package
therefore raises one exception type with the same concise messages used by the Node consumer.
"""


class ScrollcaseConsumerError(RuntimeError):
    """A local box could not be verified, prepared, or executed safely."""
