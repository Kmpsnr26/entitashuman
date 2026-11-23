export interface ParsedSseEvent {
  event?: string;
  data: string;
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ParsedSseEvent> {
  const reader =
    body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";

  try {
    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      while (true) {
        const separator =
          buffer.search(
            /\r?\n\r?\n/
          );

        if (
          separator ===
          -1
        ) {
          break;
        }

        const raw =
          buffer.slice(
            0,
            separator
          );

        const match =
          buffer
            .slice(separator)
            .match(
              /^\r?\n\r?\n/
            );

        buffer =
          buffer.slice(
            separator +
            (
              match?.[0]
                .length ??
              2
            )
          );

        let event:
          string |
          undefined;

        const dataLines:
          string[] = [];

        for (
          const line
          of raw.split(
            /\r?\n/
          )
        ) {
          if (
            line.startsWith(
              "event:"
            )
          ) {
            event =
              line
                .slice(6)
                .trim();
          }

          if (
            line.startsWith(
              "data:"
            )
          ) {
            dataLines.push(
              line
                .slice(5)
                .trimStart()
            );
          }
        }

        if (
          dataLines.length
        ) {
          yield {
            event,
            data:
              dataLines.join(
                "\n"
              )
          };
        }
      }
    }

    buffer +=
      decoder.decode();

    if (buffer.trim()) {
      const dataLines =
        buffer
          .split(/\r?\n/)
          .filter(
            line =>
              line.startsWith(
                "data:"
              )
          )
          .map(
            line =>
              line
                .slice(5)
                .trimStart()
          );

      if (
        dataLines.length
      ) {
        yield {
          data:
            dataLines.join(
              "\n"
            )
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
