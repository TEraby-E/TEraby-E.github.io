#include <iostream>
#include <string>
using namespace std;

const int FULL = (1 << 9) - 1;
string board[9];
int rowUsed[9], colUsed[9], boxUsed[9];

int box(int row, int col) {
    return (row / 3) * 3 + col / 3;
}

int candidates(int row, int col) {
    return FULL & ~(rowUsed[row] | colUsed[col] | boxUsed[box(row, col)]);
}

void change(int row, int col, int digit, bool fill) {
    int bit = 1 << digit;
    rowUsed[row] ^= bit;
    colUsed[col] ^= bit;
    boxUsed[box(row, col)] ^= bit;
    board[row][col] = fill ? '1' + digit : '.';
}

int countBits(int mask) {
    int count = 0;
    while (mask) {
        mask &= mask - 1;
        ++count;
    }
    return count;
}

bool canComplete() {
    int row = -1, col = -1, options = 0, fewest = 10;
    for (int r = 0; r < 9; ++r) {
        for (int c = 0; c < 9; ++c) {
            if (board[r][c] != '.') continue;
            int mask = candidates(r, c), count = countBits(mask);
            if (count == 0) return false;
            if (count < fewest) {
                row = r;
                col = c;
                options = mask;
                fewest = count;
            }
        }
    }
    if (row == -1) return true;
    for (int digit = 0; digit < 9; ++digit) {
        if (!(options & (1 << digit))) continue;
        change(row, col, digit, true);
        bool possible = canComplete();
        change(row, col, digit, false);
        if (possible) return true;
    }
    return false;
}

int main() {
    for (int row = 0; row < 9; ++row) {
        if (!(cin >> board[row])) return 0;
        for (int col = 0; col < 9; ++col) {
            if (board[row][col] != '.') change(row, col, board[row][col] - '1', true);
        }
    }
    for (int row = 0; row < 9; ++row) {
        for (int col = 0; col < 9; ++col) {
            if (board[row][col] != '.') continue;
            int options = candidates(row, col);
            // 按行确定字典序最小的前缀。试填只检查是否还有任意一种补全。
            for (int digit = 0; digit < 9; ++digit) {
                if (!(options & (1 << digit))) continue;
                change(row, col, digit, true);
                if (canComplete()) break;
                change(row, col, digit, false);
            }
            if (board[row][col] == '.') return 0;
        }
    }
    for (const string &line : board) cout << line << '\n';
}
