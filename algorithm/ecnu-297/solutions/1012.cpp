#include <iostream>
using namespace std;

const int MAX_N = 12;
int n, column[MAX_N];
bool usedCol[MAX_N], usedSum[2 * MAX_N], usedDiff[2 * MAX_N];

void search(int row) {
    if (row == n) {
        for (int i = 0; i < n; ++i) {
            if (i > 0) cout << ' ';
            cout << column[i] + 1;
        }
        cout << '\n';
        return;
    }
    for (int col = 0; col < n; ++col) {
        int sum = row + col, diff = row - col + n - 1;
        if (usedCol[col] || usedSum[sum] || usedDiff[diff]) continue;
        column[row] = col;
        usedCol[col] = usedSum[sum] = usedDiff[diff] = true;
        search(row + 1);
        usedCol[col] = usedSum[sum] = usedDiff[diff] = false;
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    if (cin >> n) search(0);
}
