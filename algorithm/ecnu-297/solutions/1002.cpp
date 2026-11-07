#include <cstdio>
#include <vector>
using namespace std;

int nextChar() {
    static char buffer[1 << 16];
    static size_t pos = 0, size = 0;
    if (pos == size) {
        size = fread(buffer, 1, sizeof buffer, stdin);
        pos = 0;
        if (size == 0) return EOF;
    }
    return buffer[pos++];
}

int readInt() {
    int c = nextChar();
    while (c != EOF && c <= ' ') c = nextChar();
    int sign = 1;
    if (c == '-') {
        sign = -1;
        c = nextChar();
    }
    int value = 0;
    while (c >= '0' && c <= '9') {
        value = value * 10 + c - '0';
        c = nextChar();
    }
    return sign * value;
}

int main() {
    int cases = readInt();
    vector<int> stack;
    while (cases--) {
        int n = readInt();
        stack.clear();
        stack.reserve(n);
        int next = 1;
        bool valid = true;
        for (int i = 0; i < n; ++i) {
            int wanted = readInt();
            if (!valid) continue;
            if (wanted < 1 || wanted > n) {
                valid = false;
                continue;
            }
            // 只能按编号入栈；若目标已在栈中，就必须位于栈顶。
            while (next <= wanted) stack.push_back(next++);
            if (stack.empty() || stack.back() != wanted) valid = false;
            else stack.pop_back();
        }
        puts(valid ? "yes" : "no");
    }
}
