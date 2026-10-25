// Before 0.3.0 the app's binary was Contents/MacOS/houdinimd, and F1's
// startup script in each Houdini names that path. When the path is gone, that
// script gives F1 back to Houdini's own help. The app writes the new path in
// the script when it starts, so this launcher covers the time from an update
// to the first start of the new app: Houdini runs this, this runs the app.
// The bundle signs only code in Contents/MacOS, so it is a binary, not a
// shell script.
#include <limits.h>
#include <mach-o/dyld.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  (void)argc;
  char path[PATH_MAX];
  uint32_t size = sizeof path;
  if (_NSGetExecutablePath(path, &size) != 0) return 1;
  strcpy(strrchr(path, '/') + 1, "nodebookmd");
  argv[0] = path;
  execv(path, argv);
  return 1;
}
